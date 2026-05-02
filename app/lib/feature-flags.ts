/**
 * Feature flags — single source of truth for MVP/v2 gating.
 *
 * Combo deals + Paysafe split-payment partnerships are v2.
 * For MVP launch they default OFF unless `ENABLE_COMBO_DEALS=true`
 * is set explicitly in the environment.
 *
 * Server side: `isComboEnabledServer()` reads `ENABLE_COMBO_DEALS`.
 * Client side: `isComboEnabledClient()` reads `NEXT_PUBLIC_ENABLE_COMBO_DEALS`
 * (mirrored at build time).
 *
 * Disabled responses are returned as 503 with a "coming soon" payload so
 * the customer-facing booking site can render a friendly placeholder.
 */

export function isComboEnabledServer(): boolean {
  var v = (process.env.ENABLE_COMBO_DEALS || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

export function isComboEnabledClient(): boolean {
  var v = (process.env.NEXT_PUBLIC_ENABLE_COMBO_DEALS || "").toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

export const COMBO_DISABLED_MESSAGE =
  "Combo deals are coming soon. Please book each tour separately for now.";

export function comboDisabledResponse() {
  return new Response(
    JSON.stringify({
      ok: false,
      enabled: false,
      error: COMBO_DISABLED_MESSAGE,
      v2: true,
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}
