import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSentry } from "../_shared/sentry.ts";
import { otaUnavailableResponse } from "../_shared/ota-readiness.ts";

// Public connectivity remains blocked. Contract-shaped supplier handlers live in
// _shared/viator.ts and _shared/getyourguide.ts for isolated sandbox verification.
// Activation requires a reviewed certified deployment, never a runtime toggle.
Deno.serve(withSentry("ota-reconcile", async () => otaUnavailableResponse()));
