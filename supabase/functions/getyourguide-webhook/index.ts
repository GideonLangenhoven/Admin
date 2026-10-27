import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSentry } from "../_shared/sentry.ts";
import {
  OTA_DIRECT_CONNECTIONS_AVAILABLE,
  otaUnavailableResponse,
} from "../_shared/ota-readiness.ts";

import { handleSupplierRequest } from "../_shared/ota-runtime.ts";

// Public connectivity remains blocked. Contract-shaped supplier handlers live in
// _shared/viator.ts and _shared/getyourguide.ts for isolated sandbox verification.
// Activation requires a reviewed certified deployment, never a runtime toggle.
Deno.serve(withSentry("getyourguide-webhook", async (req) => {
  if (!OTA_DIRECT_CONNECTIONS_AVAILABLE) return otaUnavailableResponse();
  return handleSupplierRequest(req, "GETYOURGUIDE");
}));
