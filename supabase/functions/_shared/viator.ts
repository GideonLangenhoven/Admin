import {
  categoryPrices,
  date,
  equalSecret,
  type Inventory,
  json,
  localDateTime,
  type Operation,
  positive,
  price,
  type SupplierBackend,
  SupplierError,
  text,
  time,
  vacancies,
} from "./ota-supplier.ts";
// Reservation-system hosted supplier API, not the affiliate/reseller Partner API.
export function createViatorSupplierHandler(
  backend: SupplierBackend,
  credentials: { apiKey: string; supplierId: number },
) {
  return async (req: Request): Promise<Response> => {
    let envelope: Record<string, unknown> = {};
    let responseType = "";
    let reserveRequest = false;
    try {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      let body;
      try {
        body = await req.json();
      } catch {
        throw new SupplierError("VALIDATION_FAILURE", "Malformed JSON");
      }
      const path = new URL(req.url).pathname;
      const v2 = path.includes("/v2/");
      reserveRequest = path.endsWith("/v2/reserve");
      const d = v2 ? body : body?.data;
      if (!d || typeof d !== "object" || Array.isArray(d)) {
        throw new SupplierError("VALIDATION_FAILURE");
      }
      if (
        !equalSecret(
          req.headers.get("x-api-key") || (v2 ? "" : d.ApiKey) || "",
          credentials.apiKey,
        )
      ) return json({ error: "Unauthorized" }, 401);
      if ((v2 ? d.supplierId : d.SupplierId) !== credentials.supplierId) {
        return json({ error: "INVALID_SUPPLIER" }, 422);
      }
      if (!v2) {
        if (
          typeof d.ResellerId !== "string" ||
          !Number.isFinite(Date.parse(d.Timestamp))
        ) throw new SupplierError("VALIDATION_FAILURE");
        envelope = {
          ApiKey: credentials.apiKey,
          ResellerId: d.ResellerId,
          SupplierId: d.SupplierId,
          Timestamp: d.Timestamp,
          ...(d.ExternalReference
            ? { ExternalReference: d.ExternalReference }
            : {}),
        };
        responseType = String(body.requestType || "").replace(
          /Request$/,
          "Response",
        );
      }
      if (path.endsWith("/tourlist")) {
        if (body.requestType !== "TourListRequest") {
          throw new SupplierError("VALIDATION_FAILURE");
        }
        const products = await backend.catalog();
        const tours: Record<string, unknown>[] = [];
        for (const p of products) {
          if (!p.catalog || !p.supplierOptionId) {
            throw new SupplierError(
              "INTERNAL_SYSTEM_FAILURE",
              "Supplier catalog metadata and option identifiers must be configured",
            );
          }
          const existing = tours.find((t) =>
            t.SupplierProductCode === p.product
          );
          if (existing) {
            (existing.TourOption as unknown[]).push({
              productOptionId: p.supplierOptionId,
              SupplierOptionCode: p.option,
            });
            continue;
          }
          tours.push({
            SupplierProductCode: p.product,
            SupplierProductName: text(p.catalog.name, "product name"),
            CountryCode: p.catalog.countryCode,
            DestinationCode: p.catalog.destinationCode,
            DestinationName: p.catalog.destinationName,
            TourDescription: p.catalog.description,
            TourOption: [{
              productOptionId: p.supplierOptionId,
              SupplierOptionCode: p.option,
            }],
          });
        }
        return json({
          responseType,
          data: {
            ...envelope,
            RequestStatus: { Status: "SUCCESS" },
            Tour: tours,
          },
        });
      }
      if (
        path.endsWith("/v2/availability/calendar") ||
        path.endsWith("/v2/availability/check")
      ) {
        const calendar = path.endsWith("/calendar");
        const from = date(calendar ? d.startDate : d.travelDate);
        const to = date(calendar ? d.endDate : d.travelDate);
        if (to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000) {
          throw new SupplierError("VALIDATION_FAILURE");
        }
        const options = calendar
          ? d.productOptionIds?.map((id: string) => ({ productOptionId: id }))
          : d.productOptions;
        if (
          !Array.isArray(options) || !options.length || options.length > 100
        ) throw new SupplierError("VALIDATION_FAILURE");
        const productOptions = [];
        for (const option of options) {
          let inventory: Inventory;
          try {
            inventory = await backend.inventory(
              "",
              "",
              text(option.productOptionId, "productOptionId"),
              { from: from + "T00:00:00+14:00", to: to + "T23:59:59-14:00" },
            );
          } catch (e) {
            if (e instanceof SupplierError && e.code === "INVALID_PRODUCT") {
              continue;
            }
            throw e;
          }
          if (!calendar) ticketQuantity(d.tickets, inventory, d.totalTravelers);
          const requested = option.startTimes?.map((t: string) =>
            time(t).slice(0, 5)
          );
          const slots = inventory.slots.filter((s) => {
            const local = localDateTime(s.start, inventory.timezone);
            return local.slice(0, 10) >= from && local.slice(0, 10) <= to &&
              (!requested || requested.includes(local.slice(11, 16)));
          });
          const events = slots.filter((s) => s.status === "OPEN").map((slot) =>
            viatorEvent(inventory, slot)
          );
          if (calendar) {
            const dates = Array.from(
              new Set(
                slots.filter((s) => s.status === "OPEN").map((s) =>
                  localDateTime(s.start, inventory.timezone).slice(0, 10)
                ),
              ),
            ).map((travelDate) => ({
              travelDate,
              events: events.filter((e) => e.localDate === travelDate).map(
                (event) =>
                  Object.fromEntries(
                    Object.entries(event).filter(([key]) =>
                      key !== "localDate"
                    ),
                  ),
              ),
            }));
            productOptions.push({
              productOptionId: option.productOptionId,
              currency: inventory.currency,
              dates,
            });
          } else {productOptions.push({
              productOptionId: option.productOptionId,
              currency: inventory.currency,
              events: events.map((event) =>
                Object.fromEntries(
                  Object.entries(event).filter(([key]) => key !== "localDate"),
                )
              ),
            });}
        }
        return json({ productOptions });
      }
      if (path.endsWith("/v2/reserve")) {
        const requestedDate = date(d.travelDate);
        const inventory = await backend.inventory(
          "",
          "",
          text(d.productOptionId, "productOptionId"),
          {
            from: requestedDate + "T00:00:00+14:00",
            to: requestedDate + "T23:59:59-14:00",
          },
        );
        const quantity = ticketQuantity(d.tickets, inventory, d.totalTravelers);
        const localDate = date(d.travelDate);
        const localTime = time(d.startTime);
        const slot = inventory.slots.find((s) =>
          localDateTime(s.start, inventory.timezone).slice(0, 19) ===
            localDate + "T" + localTime
        );
        if (!slot || slot.status !== "OPEN") {
          return json({ status: "NOT_RESERVED", reason: "NO_EVENT" });
        }
        if (Date.parse(slot.start) <= Date.now()) {
          return json({
            status: "NOT_RESERVED",
            reason: "PAST_BOOKING_CUTOFF",
          });
        }
        if (vacancies(slot) < quantity) {
          return json({
            status: "NOT_RESERVED",
            reason: vacancies(slot) === 0 ? "SOLD_OUT" : "LIMITED_AVAILABILITY",
          });
        }
        const amount = d.tickets.reduce(
          (sum: number, item: { type: string; quantity: number }) =>
            sum +
            item.quantity * categoryPrices(inventory, slot).find((p) =>
                p.category === item.type
              )!.price,
          0,
        );
        const operation: Operation = {
          operation: "reserve",
          reference: crypto.randomUUID(),
          product: inventory.product,
          option: inventory.option,
          supplier_option_id: inventory.supplierOptionId,
          date: localDate,
          time: localTime,
          quantity,
          amount,
          currency: inventory.currency,
          items: normalizedTickets(d.tickets),
        };
        const result = await backend.apply(
          "reserve:" + operation.reference,
          operation,
        );
        return json({
          status: "RESERVED",
          expiration: result.expires_at,
          reference: result.reservation_id,
          currency: inventory.currency,
          price: viatorEvent(inventory, slot).price,
        });
      }
      const operations: Record<string, { request: string; operation: string }> =
        {
          "/booking": { request: "BookingRequest", operation: "book" },
          "/booking-amendment": {
            request: "BookingAmendmentRequest",
            operation: "amend",
          },
          "/booking-cancellation": {
            request: "BookingCancellationRequest",
            operation: "cancel",
          },
        };
      const selected = Object.entries(operations).find(([suffix]) =>
        path.endsWith(suffix)
      )?.[1];
      if (!selected || body.requestType !== selected.request) {
        throw new SupplierError(
          "VALIDATION_FAILURE",
          "Unsupported supplier operation",
        );
      }
      const reference = text(d.BookingReference, "BookingReference");
      // A booking/cancellation can safely use its stable reference. Amendments
      // require the documented unique ExternalReference; content hashes or
      // changing timestamps cannot distinguish an old retry from a later change.
      if (selected.operation === "amend" && !d.ExternalReference) {
        throw new SupplierError(
          "VALIDATION_FAILURE",
          "Amendments require a stable ExternalReference",
        );
      }
      const event = d.ExternalReference
        ? text(d.ExternalReference, "ExternalReference")
        : selected.operation + ":" + reference;
      const providerPayload = Object.fromEntries(
        Object.entries(d).filter(([key]) =>
          !["ApiKey", "Retry", "Timestamp", "ExternalReference"].includes(key)
        ),
      );
      const completed = await backend.replay(event, providerPayload);
      if (completed) {
        return json({
          responseType,
          data: {
            ...envelope,
            RequestStatus: { Status: "SUCCESS" },
            BookingReference: reference,
            SupplierConfirmationNumber: completed.booking_id,
            ...(selected.operation === "cancel"
              ? { SupplierCancellationNumber: completed.booking_id + "-cancel" }
              : {}),
            TransactionStatus: { Status: "CONFIRMED" },
          },
        });
      }
      let operation: Operation = {
        operation: selected.operation,
        reference,
        provider_payload: providerPayload,
      };
      if (selected.operation !== "book") {
        operation.supplier_reference = text(
          d.SupplierConfirmationNumber,
          "SupplierConfirmationNumber",
        );
      }
      if (selected.operation !== "cancel") {
        const requestedDate = date(d.TravelDate);
        const inventory = await backend.inventory(
          text(d.SupplierProductCode, "SupplierProductCode"),
          d.TourOptions?.SupplierOptionCode || "",
          undefined,
          {
            from: requestedDate + "T00:00:00+14:00",
            to: requestedDate + "T23:59:59-14:00",
          },
        );
        const localDate = date(d.TravelDate);
        const candidates = inventory.slots.filter((s) =>
          localDateTime(s.start, inventory.timezone).slice(0, 10) === localDate
        );
        if (!candidates.length) throw new SupplierError("NO_AVAILABILITY");
        if (!d.TourOptions?.TourDepartureTime && candidates.length !== 1) {
          throw new SupplierError(
            "VALIDATION_FAILURE",
            "Departure time is required when the local date has multiple departures",
          );
        }
        const localTime = d.TourOptions?.TourDepartureTime
          ? time(d.TourOptions.TourDepartureTime)
          : localDateTime(candidates[0].start, inventory.timezone).slice(
            11,
            19,
          );
        if (!Array.isArray(d.Traveller) || !d.Traveller.length) {
          throw new SupplierError("VALIDATION_FAILURE", "Traveller required");
        }
        const counts = new Map<string, number>();
        for (const traveler of d.Traveller) {
          text(traveler.TravellerIdentifier, "TravellerIdentifier");
          text(traveler.GivenName, "GivenName");
          text(traveler.Surname, "Surname");
          const category = text(traveler.AgeBand, "AgeBand").toUpperCase();
          if (!Object.hasOwn(inventory.categories, category)) {
            throw new SupplierError("INVALID_TICKET_CATEGORY");
          }
          counts.set(category, (counts.get(category) || 0) + 1);
        }
        const lead = d.Traveller.find((t: { LeadTraveller?: boolean }) =>
          t.LeadTraveller
        ) || d.Traveller[0];
        operation = {
          ...operation,
          product: inventory.product,
          option: inventory.option,
          supplier_option_id: inventory.supplierOptionId,
          date: localDate,
          time: localTime,
          quantity: d.Traveller.length,
          amount: d.Amount === undefined
            ? d.Traveller.reduce((sum: number, t: { AgeBand: string }) =>
              sum + categoryPrices(
                inventory,
                candidates.find((s) =>
                  localDateTime(s.start, inventory.timezone).slice(11, 19) ===
                    localTime
                ) || candidates[0],
              ).find((p) =>
                p.category === t.AgeBand.toUpperCase()
              )!.price, 0)
            : price(d.Amount),
          net_amount: d.Amount === undefined ? null : price(d.Amount),
          currency: d.CurrencyCode === undefined
            ? inventory.currency
            : text(d.CurrencyCode, "CurrencyCode"),
          items: normalizedTickets(
            Array.from(counts, ([type, quantity]) => ({ type, quantity })),
          ),
          customer_name: lead.GivenName + " " + lead.Surname,
          email: d.ContactEmail || "",
          phone: d.ContactDetail?.ContactValue || "",
        };
        if (d.AvailabilityHoldReference) {
          operation.reservation_reference = text(
            d.AvailabilityHoldReference,
            "AvailabilityHoldReference",
          );
        }
      } else {
        date(d.CancelDate);
        text(d.Author, "Author");
        text(d.Reason, "Reason");
      }
      const result = await backend.apply(event, operation);
      return json({
        responseType,
        data: {
          ...envelope,
          RequestStatus: { Status: "SUCCESS" },
          BookingReference: reference,
          SupplierConfirmationNumber: result.booking_id,
          ...(selected.operation === "cancel"
            ? { SupplierCancellationNumber: result.booking_id + "-cancel" }
            : {}),
          TransactionStatus: { Status: "CONFIRMED" },
        },
      });
    } catch (error) {
      const e = error instanceof SupplierError
        ? error
        : new SupplierError("INTERNAL_SYSTEM_FAILURE");
      if (!responseType) {
        if (reserveRequest && e.code === "NO_AVAILABILITY") {
          return json({
            status: "NOT_RESERVED",
            reason: "LIMITED_AVAILABILITY",
          });
        }
        if (reserveRequest && e.code === "INVALID_TICKET_CATEGORY") {
          return json({
            status: "NOT_RESERVED",
            reason: "UNSUPPORTED_TICKET_COMBINATION",
          });
        }
        if (e.code === "INVALID_PRODUCT") {
          return json({ error: "INVALID_PRODUCT_OPTION" }, 422);
        }
        if (e.code === "VALIDATION_FAILURE") {
          return json({ error: "VALIDATION_FAILURE", message: e.message }, 400);
        }
        return json({ error: "INTERNAL_ERROR" }, 500);
      }
      return json({
        responseType,
        data: {
          ...envelope,
          RequestStatus: {
            Status: "ERROR",
            Error: { ErrorCode: e.code, ErrorMessage: e.message },
          },
        },
      });
    }
  };
}
function normalizedTickets(tickets: { type: string; quantity: number }[]) {
  return tickets.map((t) => ({ type: t.type, quantity: t.quantity })).sort((
    a,
    b,
  ) => a.type.localeCompare(b.type));
}
function ticketQuantity(
  tickets: unknown,
  inventory: Inventory,
  total: unknown,
): number {
  if (!Array.isArray(tickets) || !tickets.length) {
    throw new SupplierError("VALIDATION_FAILURE", "tickets required");
  }
  const qty = tickets.reduce((sum, t) => {
    if (!Object.hasOwn(inventory.categories, t.type)) {
      throw new SupplierError("INVALID_TICKET_CATEGORY");
    }
    return sum + positive(t.quantity);
  }, 0);
  if (positive(total) !== qty) {
    throw new SupplierError(
      "VALIDATION_FAILURE",
      "totalTravelers disagrees with tickets",
    );
  }
  return qty;
}
function viatorEvent(inventory: Inventory, slot: Inventory["slots"][number]) {
  const remaining = vacancies(slot);
  const local = localDateTime(slot.start, inventory.timezone);
  return {
    localDate: local.slice(0, 10),
    startTime: local.slice(11, 16),
    status: remaining > 0 ? "AVAILABLE" : "UNAVAILABLE",
    ...(remaining > 0 ? {} : {
      unavailableReason: Date.parse(slot.start) <= Date.now()
        ? "PAST_BOOKING_CUTOFF"
        : "SOLD_OUT",
    }),
    bookingCutoff: new Date(slot.start).toISOString(),
    capacity: {
      type: "LIMITED",
      original: slot.capacity,
      remaining,
      vacancies: [{
        types: Object.keys(inventory.categories),
        quantity: remaining,
        quantityType: "SHARED",
      }],
    },
    price: {
      type: "PER_PERSON_PRICE",
      prices: categoryPrices(inventory, slot).map((p) => ({
        types: [p.category],
        retailPrice: p.price,
      })),
    },
  };
}
export async function viatorNotifyEvents(
  baseUrl: string,
  apiKey: string,
  payload: unknown,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const url = new URL("/v2/notification/events", baseUrl);
  if (url.protocol !== "https:") throw new Error("HTTPS provider URL required");
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 204) return;
  if (response.status === 207) {
    const body = await response.json();
    const ids = (payload as { productOptionIds?: string[] }).productOptionIds ||
      [];
    if (
      Array.isArray(body.results) && ids.length > 0 &&
      ids.every((id) =>
        body.results.some((r: { productOptionId: string; status: number }) =>
          r.productOptionId === id && r.status === 200
        )
      )
    ) return;
  }
  throw new Error("Viator event notification failed or partially rejected");
}
