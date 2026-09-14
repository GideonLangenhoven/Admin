// Optional request-level OpenRouter provider constraints, env-driven (POPIA).
// All unset → no `provider` object is sent → routing behaves exactly as today.
//
//   OPENROUTER_PROVIDER_IGNORE   comma-separated provider slugs to exclude,
//                                e.g. "deepseek" keeps first-party
//                                (China-hosted) DeepSeek endpoints out of the
//                                pool so only US/EU hosts serve the model
//   OPENROUTER_DATA_COLLECTION   "deny" → route only to providers that do not
//                                collect/store user data
//   OPENROUTER_ZDR               "true" → route only to Zero Data Retention
//                                endpoints (strongest; shrinks the pool)
//
// Field names verified against openrouter.ai/docs/features/provider-routing.
import { sha256Hex } from "./kb.ts";

function build(): Record<string, unknown> | null {
  const prefs: Record<string, unknown> = {};
  const ignore = (Deno.env.get("OPENROUTER_PROVIDER_IGNORE") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (ignore.length) prefs.ignore = ignore;
  if ((Deno.env.get("OPENROUTER_DATA_COLLECTION") || "").toLowerCase() === "deny") prefs.data_collection = "deny";
  if ((Deno.env.get("OPENROUTER_ZDR") || "").toLowerCase() === "true") prefs.zdr = true;
  return Object.keys(prefs).length ? prefs : null;
}

export const OPENROUTER_PROVIDER_PREFS = build();

// POPIA minimality: OpenRouter's `user` field needs a STABLE identifier for
// abuse detection, not an identifiable one. Hash business:identifier so raw
// phone numbers never leave the platform. Deterministic, so the same
// conversation always maps to the same value.
export async function hashedUserKey(businessId: string, identifier: string): Promise<string> {
  return (await sha256Hex(businessId + ":" + identifier)).slice(0, 32);
}
