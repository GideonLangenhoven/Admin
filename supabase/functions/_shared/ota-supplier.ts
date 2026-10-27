// Supplier contracts: docs.viator.com/supplier-api/technical and integrator.getyourguide.com.
// This module is exercised in isolated databases. Public entrypoints remain release-blocked.
export type Channel = "VIATOR" | "GETYOURGUIDE";
export type Operation = Record<string, unknown> & {
  operation: string;
  reference: string;
};
export type Inventory = {
  product: string;
  option: string;
  supplierOptionId: string;
  tourId: string;
  timezone: string;
  currency: string;
  catalog?: {
    name: string;
    description: string;
    countryCode: string;
    destinationCode: string;
    destinationName: string;
  };
  categories: Record<string, number>;
  slots: {
    id: string;
    start: string;
    status: string;
    capacity: number;
    booked: number;
    held: number;
    price?: number;
  }[];
};
export type SupplierBackend = {
  catalog: () => Promise<Inventory[]>;
  inventory: (
    product: string,
    option: string,
    supplierOptionId?: string,
    range?: { from: string; to: string },
  ) => Promise<Inventory>;
  replay: (
    eventId: string,
    providerPayload: unknown,
  ) => Promise<
    {
      booking_id?: string;
      supplier_reference?: string;
      reservation_id?: string;
      expires_at?: string;
    } | null
  >;
  reservation: (reference: string) => Promise<Operation>;
  apply: (
    eventId: string,
    operation: Operation,
  ) => Promise<
    {
      booking_id?: string;
      supplier_reference?: string;
      reservation_id?: string;
      expires_at?: string;
    }
  >;
};
export class SupplierError extends Error {
  constructor(
    public code: string,
    message = code,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SupplierError("VALIDATION_FAILURE", `${name} is required`);
  }
  return value;
}
export function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new SupplierError(
      "VALIDATION_FAILURE",
      "Ticket counts must be positive integers",
    );
  }
  return Number(value);
}
export function date(value: unknown): string {
  const d = text(value, "date");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) ||
    new Date(d).toISOString().slice(0, 10) !== d
  ) throw new SupplierError("VALIDATION_FAILURE", "Invalid local date");
  return d;
}
export function time(value: unknown): string {
  const t = text(value, "start time");
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(t)) {
    throw new SupplierError("VALIDATION_FAILURE", "Invalid start time");
  }
  return t.length === 5 ? t + ":00" : t;
}
export function localDateTime(instant: string, timezone: string): string {
  const d = new Date(instant);
  if (!Number.isFinite(d.valueOf())) {
    throw new SupplierError("VALIDATION_FAILURE", "Invalid dateTime");
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const local =
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const offset = Math.round((Date.parse(local + "Z") - d.valueOf()) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  return `${local}${sign}${
    String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")
  }:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
}
export function offsetDateTime(value: unknown, timezone?: string): string {
  const dt = text(value, "dateTime").replace(/\.0+(?=Z|[+-])/, "");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
      .test(dt) ||
    !Number.isFinite(Date.parse(dt)) ||
    (timezone && localDateTime(dt, timezone) !== dt)
  ) {
    throw new SupplierError(
      "VALIDATION_FAILURE",
      "dateTime must use the activity local time and offset",
    );
  }
  return dt;
}
export function price(value: unknown): number {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n) || n < 0) {
    throw new SupplierError(
      "INTERNAL_SYSTEM_FAILURE",
      "A configured category price is invalid",
    );
  }
  return n;
}
export function minorUnits(amount: number, currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new SupplierError(
      "INTERNAL_SYSTEM_FAILURE",
      "Invalid operator currency",
    );
  }
  const exponent = new Intl.NumberFormat("en", { style: "currency", currency })
    .resolvedOptions().maximumFractionDigits;
  const value = Math.round(price(amount) * 10 ** (exponent ?? 2));
  if (!Number.isSafeInteger(value)) {
    throw new SupplierError(
      "INTERNAL_SYSTEM_FAILURE",
      "Price exceeds supported range",
    );
  }
  return value;
}
export async function fingerprint(value: unknown): Promise<string> {
  function canonical(x: unknown): string {
    if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
    if (x && typeof x === "object") {
      return "{" + Object.entries(x).sort(([a], [b]) =>
        a.localeCompare(b)
      ).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
    }
    return JSON.stringify(x);
  }
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function equalSecret(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return b.length > 0 && mismatch === 0;
}
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
export function vacancies(
  slot: Inventory["slots"][number],
  now = Date.now(),
): number {
  return slot.status === "OPEN" && Date.parse(slot.start) > now
    ? Math.max(0, slot.capacity - slot.booked - slot.held)
    : 0;
}
export function categoryPrices(
  inventory: Inventory,
  slot: Inventory["slots"][number],
) {
  return Object.entries(inventory.categories).map(([category, amount]) => ({
    category,
    price: price(category === "ADULT" ? slot.price ?? amount : amount),
  }));
}
