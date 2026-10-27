import {
  type Channel,
  fingerprint,
  type Inventory,
  type Operation,
  price,
  type SupplierBackend,
  SupplierError,
} from "./ota-supplier.ts";
// Supabase query builder is injected so tests execute the same adapter without credentials.
// deno-lint-ignore no-explicit-any
export function createSupplierBackend(
  db: any,
  businessId: string,
  channel: Channel,
): SupplierBackend {
  async function inventory(
    product: string,
    option: string,
    supplierOptionId?: string,
    range?: { from: string; to: string },
  ): Promise<Inventory> {
    let query = db.from("ota_product_mappings").select(
      "tour_id,external_product_code,external_option_code,supplier_option_id,category_prices,catalog",
    )
      .eq("business_id", businessId).eq("channel", channel).eq("enabled", true);
    query = supplierOptionId
      ? query.eq("supplier_option_id", supplierOptionId)
      : query.eq("external_product_code", product).eq(
        "external_option_code",
        option || null,
      );
    // Null equality requires IS in PostgREST.
    if (!supplierOptionId && !option) {
      query = db.from("ota_product_mappings").select(
        "tour_id,external_product_code,external_option_code,supplier_option_id,category_prices,catalog",
      )
        .eq("business_id", businessId).eq("channel", channel).eq(
          "enabled",
          true,
        ).eq("external_product_code", product).is("external_option_code", null);
    }
    const mappings = await query;
    if (mappings.error) {
      throw new SupplierError(
        "INTERNAL_SYSTEM_FAILURE",
        "Mapping lookup failed",
      );
    }
    if (mappings.data?.length !== 1) {
      throw new SupplierError(
        "INVALID_PRODUCT",
        "Product and option must have exactly one mapping",
      );
    }
    const mapping = mappings.data[0];
    const [tour, business] = await Promise.all([
      db.from("tours").select("id,active,base_price_per_person").eq(
        "id",
        mapping.tour_id,
      ).eq("business_id", businessId).maybeSingle(),
      db.from("businesses").select("timezone,currency").eq("id", businessId)
        .single(),
    ]);
    if (tour.error || business.error) {
      throw new SupplierError(
        "INTERNAL_SYSTEM_FAILURE",
        "Operator/tour lookup failed",
      );
    }
    if (!tour.data?.active) {
      throw new SupplierError(
        "INVALID_PRODUCT",
        "Mapped tour is inactive or belongs to another operator",
      );
    }
    const categories = Object.keys(mapping.category_prices || {}).length
      ? mapping.category_prices
      : { ADULT: price(tour.data.base_price_per_person) };
    const expiry = await db.rpc("ota_expire_reservations", {
      p_business_id: businessId,
    });
    if (expiry.error) {
      throw new SupplierError(
        "INTERNAL_SYSTEM_FAILURE",
        "Reservation expiry failed",
      );
    }
    const allowed = channel === "VIATOR"
      ? ["ADULT", "CHILD", "YOUTH", "INFANT", "SENIOR"]
      : [
        "ADULT",
        "CHILD",
        "YOUTH",
        "INFANT",
        "SENIOR",
        "STUDENT",
        "EU_CITIZEN",
        "MILITARY",
        "EU_CITIZEN_STUDENT",
      ];
    if (Object.keys(categories).some((c) => !allowed.includes(c))) {
      throw new SupplierError(
        "INTERNAL_SYSTEM_FAILURE",
        "Unsupported category in mapping",
      );
    }
    for (const value of Object.values(categories)) price(value);
    const slots: Inventory["slots"] = [];
    const fromTime = range?.from || new Date().toISOString();
    const toTime = range?.to ||
      new Date(Date.now() + 366 * 86400000).toISOString();
    for (let from = 0; from < 10000; from += 500) {
      const page = await db.from("slots").select(
        "id,start_time,status,capacity_total,booked,held,price_per_person_override",
      )
        .eq("business_id", businessId).eq("tour_id", mapping.tour_id).gte(
          "start_time",
          fromTime,
        ).lte("start_time", toTime).order("id").range(from, from + 499);
      if (page.error) {
        throw new SupplierError(
          "INTERNAL_SYSTEM_FAILURE",
          "Departure lookup failed; no availability exported",
        );
      }
      for (const s of page.data || []) {
        slots.push({
          id: s.id,
          start: s.start_time,
          status: s.status,
          capacity: s.capacity_total,
          booked: s.booked,
          held: s.held,
          price: s.price_per_person_override ?? undefined,
        });
      }
      if ((page.data || []).length < 500) {
        return {
          product: mapping.external_product_code,
          option: mapping.external_option_code || "",
          supplierOptionId: mapping.supplier_option_id,
          tourId: mapping.tour_id,
          timezone: business.data.timezone,
          currency: business.data.currency,
          categories,
          catalog: mapping.catalog,
          slots,
        };
      }
    }
    throw new SupplierError(
      "INTERNAL_SYSTEM_FAILURE",
      "Departure catalogue exceeds safe export bound; narrow the inventory query before release",
    );
  }
  async function apply(eventId: string, operation: Operation) {
    const result = await db.rpc("ota_apply_operation", {
      p_business_id: businessId,
      p_channel: channel,
      p_environment: "SANDBOX",
      p_event_id: eventId,
      p_request: operation,
    });
    if (result.error) {
      const code = [
        "VALIDATION_FAILURE",
        "INVALID_PRODUCT",
        "NO_AVAILABILITY",
        "INVALID_RESERVATION",
        "INVALID_BOOKING",
        "IDEMPOTENCY_CONFLICT",
        "OTA_NOT_READY",
      ].find((c) => String(result.error.message).includes(c));
      throw new SupplierError(
        code || "INTERNAL_SYSTEM_FAILURE",
        code || "Booking transaction failed; retry safely",
      );
    }
    if (!result.data) {
      throw new SupplierError(
        "INTERNAL_SYSTEM_FAILURE",
        "Booking transaction returned no result",
      );
    }
    return result.data;
  }
  async function reservation(reference: string): Promise<Operation> {
    const r = await db.from("ota_reservations").select("details").eq(
      "id",
      reference,
    ).eq("business_id", businessId).eq("channel", channel).eq(
      "environment",
      "SANDBOX",
    ).maybeSingle();
    if (r.error) {
      throw new SupplierError(
        "INTERNAL_SYSTEM_FAILURE",
        "Reservation lookup failed",
      );
    }
    if (!r.data) throw new SupplierError("INVALID_RESERVATION");
    return r.data.details;
  }
  async function catalog(): Promise<Inventory[]> {
    const mappings = await db.from("ota_product_mappings").select(
      "external_product_code,external_option_code",
    ).eq("business_id", businessId).eq("channel", channel).eq("enabled", true)
      .order("id").limit(1001);
    if (mappings.error || mappings.data.length > 1000) {
      throw new SupplierError(
        "INTERNAL_SYSTEM_FAILURE",
        "Catalog query failed or exceeds safe bound",
      );
    }
    return Promise.all(
      mappings.data.map((
        m: { external_product_code: string; external_option_code: string },
      ) => inventory(m.external_product_code, m.external_option_code || "")),
    );
  }
  async function replay(eventId: string, providerPayload: unknown) {
    const e = await db.from("ota_events").select("payload,result").eq(
      "business_id",
      businessId,
    ).eq("channel", channel).eq("environment", "SANDBOX").eq(
      "event_id",
      eventId,
    ).maybeSingle();
    if (e.error) {
      throw new SupplierError(
        "INTERNAL_SYSTEM_FAILURE",
        "Completed request lookup failed",
      );
    }
    if (!e.data) return null;
    if (eventId.startsWith("reserve:")) {
      const r = await db.from("ota_reservations").select(
        "status,expires_at,booking_id",
      ).eq("id", e.data.result.reservation_id).eq("business_id", businessId).eq(
        "channel",
        channel,
      ).eq("environment", "SANDBOX").maybeSingle();
      if (r.error || !r.data) {
        throw new SupplierError(
          "INTERNAL_SYSTEM_FAILURE",
          "Reservation replay lookup failed",
        );
      }
      if (
        r.data.status === "EXPIRED" ||
        (r.data.status === "ACTIVE" &&
          Date.parse(r.data.expires_at) <= Date.now())
      ) return null;
      if (r.data.status === "CONSUMED") {
        const b = await db.from("bookings").select("status").eq(
          "id",
          r.data.booking_id,
        ).eq("business_id", businessId).maybeSingle();
        if (b.error) {
          throw new SupplierError(
            "INTERNAL_SYSTEM_FAILURE",
            "Booking replay lookup failed",
          );
        }
        if (b.data?.status === "CANCELLED") return null;
      }
    }
    if (
      await fingerprint(e.data.payload.provider_payload) !==
        await fingerprint(providerPayload)
    ) throw new SupplierError("IDEMPOTENCY_CONFLICT");
    return e.data.result;
  }
  return { inventory, apply, reservation, catalog, replay };
}
