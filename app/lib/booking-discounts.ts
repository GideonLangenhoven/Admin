export type BookingDiscountRule = {
  name: string; kind: "frequency" | "recency" | "group"; enabled: boolean; percent: number;
  min_guests: number; max_guests: number | null;
  min_bookings?: number; window_days?: number; min_days?: number; max_days?: number | null;
};

export function legacyBookingDiscountRules(policy: Record<string, unknown> = {}): BookingDiscountRule[] {
  return [
    { name: "Loyalty discount", kind: "frequency", enabled: true, percent: Number(policy.loyalty_discount_percent ?? 10), min_guests: 1, max_guests: null, min_bookings: Number(policy.loyalty_bookings_threshold ?? 2), window_days: Number(policy.loyalty_period_days ?? 30) },
    { name: "Group discount", kind: "group", enabled: true, percent: Number(policy.group_discount_percent ?? 5), min_guests: Number(policy.group_discount_min_qty ?? 6), max_guests: null },
  ];
}

export function validateBookingDiscountRules(rules: BookingDiscountRule[]): string | null {
  const integer = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
  if (rules.length > 20) return "Use at most 20 automatic discount rules.";
  for (const [index, rule] of rules.entries()) {
    const prefix = `Rule ${index + 1}: `;
    if (!rule.name.trim() || rule.name.trim().length > 80) return prefix + "enter a name of up to 80 characters.";
    if (!["frequency", "recency", "group"].includes(rule.kind) || typeof rule.enabled !== "boolean") return prefix + "choose a valid rule type.";
    if (!Number.isSafeInteger(rule.percent) || rule.percent < 0 || rule.percent > 100) return prefix + "discount must be a whole percentage between 0% and 100%.";
    if (!integer(rule.min_guests, 1, 50) || (rule.max_guests != null && !integer(rule.max_guests, rule.min_guests, 50))) return prefix + "guest limits must be whole numbers from 1 to 50, with the maximum at least the minimum.";
    if (rule.kind === "frequency" && (!integer(rule.min_bookings, 1, 10000) || !integer(rule.window_days, 1, 3650))) return prefix + "enter bookings required (1–10,000) and a period in days (1–3,650).";
    if (rule.kind === "recency" && (!integer(rule.min_days, 0, 36500) || (rule.max_days != null && !integer(rule.max_days, rule.min_days!, 36500)))) return prefix + "enter valid whole-day limits, with the maximum at least the minimum.";
  }
  return null;
}
