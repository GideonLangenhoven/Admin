import { createServiceClient } from "./tenant.ts";
import { createSupplierBackend } from "./ota-backend.ts";
import { createViatorSupplierHandler, viatorNotifyEvents } from "./viator.ts";
import {
  createGygSupplierHandler,
  gygNotifyAvailability,
} from "./getyourguide.ts";
import { syncSupplierAvailability } from "./ota-availability.ts";
import { type Channel, equalSecret, json } from "./ota-supplier.ts";
// Called only after the public hard release boundary. This wiring is also tested
// with injected isolated service clients; there is no activation env variable.
// deno-lint-ignore no-explicit-any
export async function handleSupplierRequest(
  req: Request,
  channel: Channel,
  db: any = createServiceClient(),
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): Promise<Response> {
  if (channel === "VIATOR") {
    const businessId = new URL(req.url).searchParams.get("b");
    if (!businessId) return json({ error: "Unauthorized" }, 401);
    const integration = await db.from("ota_integrations").select(
      "config_json,enabled,test_mode",
    ).eq("business_id", businessId).eq("channel", channel).maybeSingle();
    if (integration.error) return json({ error: "INTERNAL_ERROR" }, 500);
    if (!integration.data?.enabled || !integration.data.test_mode) {
      return json({ error: "OTA_NOT_READY" }, 503);
    }
    const credentials = await db.rpc("get_ota_credentials", {
      p_business_id: businessId,
      p_channel: channel,
      p_key: env("SETTINGS_ENCRYPTION_KEY") || "",
    });
    if (credentials.error) return json({ error: "INTERNAL_ERROR" }, 500);
    const row = Array.isArray(credentials.data)
      ? credentials.data[0]
      : credentials.data;
    if (
      !row?.api_key ||
      !Number.isInteger(integration.data.config_json?.supplier_id)
    ) return json({ error: "Unauthorized" }, 401);
    return createViatorSupplierHandler(
      createSupplierBackend(db, businessId, channel),
      {
        apiKey: row.api_key,
        supplierId: integration.data.config_json.supplier_id,
      },
    )(req);
  }
  const username = env("GYG_SUPPLIER_USERNAME") || "";
  const password = env("GYG_SUPPLIER_PASSWORD") || "";
  if (
    !username || !password ||
    !equalSecret(
      req.headers.get("authorization") || "",
      "Basic " + btoa(username + ":" + password),
    )
  ) {
    return json({
      errorCode: "AUTHORIZATION_FAILURE",
      errorMessage: "Invalid supplier API credentials",
    });
  }
  const path = new URL(req.url).pathname;
  const supported = [
    "/1/get-availabilities/",
    "/1/reserve/",
    "/1/book/",
    "/1/cancel-booking/",
    "/1/cancel-reservation/",
  ];
  if (!supported.some((p) => path.endsWith(p))) {
    return json({
      errorCode: "VALIDATION_FAILURE",
      errorMessage: "Unsupported supplier operation",
    });
  }
  let productId = new URL(req.url).searchParams.get("productId");
  let reservationId: string | undefined;
  let bookingId: string | undefined;
  if (req.method === "POST") {
    try {
      const body = await req.clone().json();
      productId = body.data?.productId;
      reservationId = body.data?.reservationReference;
      bookingId = body.data?.bookingReference;
    } catch {
      return json({
        errorCode: "VALIDATION_FAILURE",
        errorMessage: "Malformed JSON",
      });
    }
  }
  let resolution;
  if (bookingId) {
    resolution = await db.from("bookings").select("business_id").eq(
      "ota_supplier_reference",
      bookingId,
    ).eq("ota_channel", channel).eq("ota_environment", "SANDBOX");
  } else if (reservationId) {
    resolution = await db.from("ota_reservations").select("business_id").eq(
      "id",
      reservationId,
    ).eq("channel", channel).eq("environment", "SANDBOX");
  } else if (productId) {
    resolution = await db.from("ota_product_mappings").select("business_id").eq(
      "external_product_code",
      productId,
    ).is("external_option_code", null).eq("channel", channel).eq(
      "enabled",
      true,
    );
  }
  if (!resolution || resolution.error || resolution.data?.length !== 1) {
    return json({
      errorCode: resolution?.error
        ? "INTERNAL_SYSTEM_FAILURE"
        : path.endsWith("/cancel-booking/")
        ? "INVALID_BOOKING"
        : (path.endsWith("/book/") || path.endsWith("/cancel-reservation/"))
        ? "INVALID_RESERVATION"
        : "INVALID_PRODUCT",
      errorMessage:
        "Supplier product/reservation must resolve to exactly one operator",
    });
  }
  const businessId = resolution.data[0].business_id;
  const integration = await db.from("ota_integrations").select(
    "enabled,test_mode",
  ).eq("business_id", businessId).eq("channel", channel).maybeSingle();
  if (
    integration.error || !integration.data?.enabled ||
    !integration.data.test_mode
  ) {
    return json({
      errorCode: "INTERNAL_SYSTEM_FAILURE",
      errorMessage: "Operator sandbox connection is not configured",
    });
  }
  return createGygSupplierHandler(
    createSupplierBackend(db, businessId, channel),
    { username, password },
  )(req);
}

// Explicit provider-issued notification host is required; no sandbox host is guessed.
// deno-lint-ignore no-explicit-any
export async function handleAvailabilitySyncRequest(
  req: Request,
  channel: Channel,
  db: any = createServiceClient(),
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (
    !key ||
    !equalSecret(req.headers.get("authorization") || "", "Bearer " + key)
  ) return json({ error: "Unauthorized" }, 401);
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const integrations = [];
    for (let from = 0; from < 1000; from += 100) {
      const page = await db.from("ota_integrations").select(
        "business_id,config_json",
      ).eq("channel", channel).eq("enabled", true).eq("test_mode", true).order(
        "business_id",
      ).range(from, from + 99);
      if (page.error) throw new Error("OTA integrations scan failed");
      integrations.push(...(page.data || []));
      if ((page.data || []).length < 100) break;
      if (from === 900) {
        throw new Error("OTA integrations scan exceeds bounded worker limit");
      }
    }
    const results = [];
    for (const integration of integrations) {
      const baseUrl = integration.config_json?.notification_base_url;
      if (typeof baseUrl !== "string") {
        throw new Error(
          "Provider-issued notification base URL is not configured",
        );
      }
      const url = new URL(baseUrl);
      const domain = channel === "VIATOR" ? "viator.com" : "getyourguide.com";
      if (
        url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") || !url.hostname.endsWith("." + domain)
      ) {
        throw new Error(
          "Notification URL must be an HTTPS provider-owned host",
        );
      }
      let notify: (payload: unknown) => Promise<void>;
      if (channel === "VIATOR") {
        const creds = await db.rpc("get_ota_credentials", {
          p_business_id: integration.business_id,
          p_channel: channel,
          p_key: env("SETTINGS_ENCRYPTION_KEY") || "",
        });
        const credential = Array.isArray(creds.data)
          ? creds.data[0]
          : creds.data;
        if (creds.error || !credential?.api_key) {
          throw new Error("Viator notification credentials are unavailable");
        }
        notify = (payload) =>
          viatorNotifyEvents(baseUrl, credential.api_key, payload, fetcher);
      } else {
        const username = env("GYG_NOTIFICATION_USERNAME") || "";
        const password = env("GYG_NOTIFICATION_PASSWORD") || "";
        if (!username || !password) {
          throw new Error(
            "Platform GYG-issued Basic notification credentials are unavailable",
          );
        }
        notify = (payload) =>
          gygNotifyAvailability(
            baseUrl,
            { username, password },
            payload,
            fetcher,
          );
      }
      results.push({
        business_id: integration.business_id,
        ...await syncSupplierAvailability(
          db,
          integration.business_id,
          channel,
          notify,
        ),
      });
    }
    return json({ ok: true, results });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error
        ? error.message
        : "OTA availability sync failed",
    }, 500);
  }
}
