import {
  categoryPrices,
  equalSecret,
  fingerprint,
  type Inventory,
  json,
  localDateTime,
  minorUnits,
  offsetDateTime,
  type Operation,
  positive,
  type SupplierBackend,
  SupplierError,
  text,
  vacancies,
} from "./ota-supplier.ts";
// HTTP Basic is required in both directions. Credentials cover the whole API,
// rather than being per-operator; product ownership comes from exact mappings.
export function createGygSupplierHandler(
  backend: SupplierBackend,
  credentials: { username: string; password: string },
) {
  return async (req: Request): Promise<Response> => {
    try {
      if (
        !equalSecret(
          req.headers.get("authorization") || "",
          "Basic " + btoa(credentials.username + ":" + credentials.password),
        ) || !credentials.username || !credentials.password
      ) {
        throw new SupplierError("AUTHORIZATION_FAILURE");
      }
      const path = new URL(req.url).pathname;
      if (path.endsWith("/1/get-availabilities/")) {
        if (req.method !== "GET") {
          throw new SupplierError("VALIDATION_FAILURE", "GET required");
        }
        const q = new URL(req.url).searchParams;
        const from = Date.parse(offsetDateTime(q.get("fromDateTime")));
        const to = Date.parse(offsetDateTime(q.get("toDateTime")));
        if (to < from || to - from > 366 * 86400000) {
          throw new SupplierError(
            "VALIDATION_FAILURE",
            "Availability range must be at most 366 days",
          );
        }
        const inventory = await backend.inventory(
          text(q.get("productId"), "productId"),
          "",
          undefined,
          {
            from: new Date(from).toISOString(),
            to: new Date(to).toISOString(),
          },
        );
        const availabilities = inventory.slots.filter((s) =>
          Date.parse(s.start) >= from && Date.parse(s.start) <= to
        ).map((slot) => ({
          dateTime: localDateTime(slot.start, inventory.timezone),
          productId: inventory.product,
          vacancies: vacancies(slot),
          currency: inventory.currency,
          pricesByCategory: {
            retailPrices: categoryPrices(inventory, slot).map((p) => ({
              category: p.category,
              price: minorUnits(p.price, inventory.currency),
            })),
          },
        }));
        return json({ data: { availabilities } });
      }
      if (req.method !== "POST") {
        throw new SupplierError("VALIDATION_FAILURE", "POST required");
      }
      let body;
      try {
        body = await req.json();
      } catch {
        throw new SupplierError("VALIDATION_FAILURE", "Malformed JSON");
      }
      const d = body?.data;
      if (!d || typeof d !== "object" || Array.isArray(d)) {
        throw new SupplierError("VALIDATION_FAILURE", "data is required");
      }
      const providerReference = text(
        d.gygBookingReference,
        "gygBookingReference",
      );
      if (path.endsWith("/1/cancel-reservation/")) {
        const reference = text(d.reservationReference, "reservationReference");
        const held = await backend.reservation(reference);
        if (held.provider_reference !== providerReference) {
          throw new SupplierError("INVALID_RESERVATION");
        }
        await backend.apply("cancel-reservation:" + reference, {
          operation: "cancel-reservation",
          reference: providerReference,
          provider_reference: providerReference,
          reservation_reference: reference,
        });
        return json({ data: {} });
      }
      if (path.endsWith("/1/cancel-booking/")) {
        const reference = text(d.bookingReference, "bookingReference");
        await backend.apply("cancel:" + reference, {
          operation: "cancel",
          reference: text(
            d.reservationReference || reference,
            "booking reference",
          ),
          supplier_reference: reference,
          provider_reference: providerReference,
          product: text(d.productId, "productId"),
        });
        return json({ data: {} });
      }
      const isReserve = path.endsWith("/1/reserve/");
      const isBook = path.endsWith("/1/book/");
      if (!isReserve && !isBook) {
        throw new SupplierError(
          "VALIDATION_FAILURE",
          "Unsupported supplier operation",
        );
      }
      const product = text(d.productId, "productId");
      let operation: Operation;
      let event: string;
      if (isBook) {
        const reference = text(d.reservationReference, "reservationReference");
        const providerPayload: Record<string, unknown> = {
          ...d,
          bookingItems: Array.isArray(d.bookingItems)
            ? d.bookingItems.map((item: Record<string, unknown>) =>
              Object.fromEntries(
                Object.entries(item).filter(([key]) => key !== "retailPrice"),
              )
            )
            : d.bookingItems,
        };
        delete providerPayload.currency;
        const completed = await backend.replay(
          "book:" + reference,
          providerPayload,
        );
        if (completed) {
          return json({
            data: {
              bookingReference: completed.supplier_reference,
              tickets: [{
                category: "COLLECTIVE",
                ticketCode: completed.booking_id,
                ticketCodeType: "TEXT",
              }],
            },
          });
        }
        const held = await backend.reservation(reference);
        const datetime = offsetDateTime(d.dateTime);
        const heldCategories = Object.fromEntries(
          (held.items as { category: string }[]).map(
            (item) => [item.category, 0],
          ),
        );
        const items = bookingItems(
          d.bookingItems,
          { categories: heldCategories } as Inventory,
        );
        if (
          held.product !== product ||
          held.provider_reference !== providerReference ||
          held.date_time !== datetime ||
          await fingerprint(held.items) !== await fingerprint(items)
        ) throw new SupplierError("INVALID_RESERVATION");
        if (
          !Array.isArray(d.travelers) || !d.travelers.length ||
          typeof d.comment !== "string"
        ) {
          throw new SupplierError(
            "VALIDATION_FAILURE",
            "travelers and comment are required",
          );
        }
        const lead = d.travelers[0];
        operation = {
          ...held,
          operation: "book",
          reference,
          reservation_reference: reference,
          provider_payload: providerPayload,
          customer_name:
            [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
            "GetYourGuide Guest",
          email: lead.email || "",
          phone: lead.phoneNumber || "",
        };
        event = "book:" + reference;
      } else {
        const requestedDateTime = offsetDateTime(d.dateTime);
        const rawItems = bookingItems(
          d.bookingItems,
          {
            categories: Object.fromEntries(
              [
                "ADULT",
                "CHILD",
                "YOUTH",
                "INFANT",
                "SENIOR",
                "STUDENT",
                "EU_CITIZEN",
                "MILITARY",
                "EU_CITIZEN_STUDENT",
              ].map((c) => [c, 0]),
            ),
          } as Inventory,
        );
        const providerPayload = {
          productId: product,
          dateTime: requestedDateTime,
          gygBookingReference: providerReference,
          bookingItems: rawItems,
          ...(d.gygActivityReference
            ? { gygActivityReference: d.gygActivityReference }
            : {}),
        };
        const reserveEvent = "reserve:" + await fingerprint(providerPayload);
        const completed = await backend.replay(reserveEvent, providerPayload);
        if (completed) {
          return json({
            data: {
              reservationReference: completed.reservation_id,
              reservationExpiration: completed.expires_at?.replace(
                "Z",
                "+00:00",
              ),
            },
          });
        }
        const inventory = await backend.inventory(product, "", undefined, {
          from: requestedDateTime,
          to: requestedDateTime,
        });
        const datetime = offsetDateTime(d.dateTime, inventory.timezone);
        const slot = inventory.slots.find((s) =>
          localDateTime(s.start, inventory.timezone) === datetime
        );
        if (!slot) throw new SupplierError("NO_AVAILABILITY");
        const items = bookingItems(d.bookingItems, inventory);
        const quantity = items.reduce((sum, item) => sum + item.count, 0);
        positive(quantity);
        const amount = items.reduce(
          (sum, item) =>
            sum +
            item.count * categoryPrices(inventory, slot).find((p) =>
                p.category === item.category
              )!.price,
          0,
        );
        operation = {
          operation: "reserve",
          reference: providerReference,
          provider_reference: providerReference,
          product,
          option: "",
          date_time: datetime,
          quantity,
          amount,
          currency: inventory.currency,
          items,
          provider_payload: providerPayload,
        };
        event = reserveEvent;
      }
      const result = await backend.apply(event, operation);
      if (isReserve) {
        return json({
          data: {
            reservationReference: result.reservation_id,
            reservationExpiration: result.expires_at?.replace("Z", "+00:00"),
          },
        });
      }
      return json({
        data: {
          bookingReference: result.supplier_reference,
          tickets: [{
            category: "COLLECTIVE",
            ticketCode: result.booking_id,
            ticketCodeType: "TEXT",
          }],
        },
      });
    } catch (error) {
      const e = error instanceof SupplierError
        ? error
        : new SupplierError("INTERNAL_SYSTEM_FAILURE");
      // All expected GYG errors, including authentication, use HTTP 200.
      const code = ["IDEMPOTENCY_CONFLICT", "OTA_NOT_READY"].includes(e.code)
        ? "INTERNAL_SYSTEM_FAILURE"
        : e.code;
      return json({ errorCode: code, errorMessage: e.message, ...e.details });
    }
  };
}
// Only individual/time-point products are supported by this local candidate.
// GROUP needs separate group inventory; it must never consume per-person seats.
function bookingItems(
  value: unknown,
  inventory: Inventory,
): { category: string; count: number }[] {
  if (!Array.isArray(value) || !value.length) {
    throw new SupplierError("VALIDATION_FAILURE", "bookingItems required");
  }
  const totals = new Map<string, number>();
  for (const item of value) {
    const category = text(item?.category, "category");
    if (
      category === "GROUP" || category === "COLLECTIVE" ||
      !Object.hasOwn(inventory.categories, category)
    ) {
      throw new SupplierError(
        "INVALID_TICKET_CATEGORY",
        "Category is not configured for individual inventory",
        { ticketCategory: category },
      );
    }
    totals.set(category, (totals.get(category) || 0) + positive(item.count));
  }
  return Array.from(totals, ([category, count]) => ({ category, count })).sort((
    a,
    b,
  ) => a.category.localeCompare(b.category));
}
// Exact documented notification path. Host and credentials must be issued by GYG;
// no guessed sandbox domain or OAuth client is retained.
export async function gygNotifyAvailability(
  baseUrl: string,
  credentials: { username: string; password: string },
  payload: unknown,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const url = new URL("/1/notify-availability-update", baseUrl);
  if (url.protocol !== "https:") throw new Error("HTTPS provider URL required");
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " +
        btoa(credentials.username + ":" + credentials.password),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok || body.errorCode || !body.data) {
    throw new Error("GYG availability notification failed");
  }
}
