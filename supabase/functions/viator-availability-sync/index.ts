import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";
import { withSentry } from "../_shared/sentry.ts";
import { createViatorClient, viatorPushAvailability } from "../_shared/viator.ts";

var SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";
var db = createServiceClient();

function headers() {
  return { "Content-Type": "application/json" };
}

Deno.serve(withSentry("viator-availability-sync", async () => {
  if (!SETTINGS_ENCRYPTION_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "SETTINGS_ENCRYPTION_KEY not set" }), { status: 503, headers: headers() });
  }

  var { data: integrations } = await db.from("ota_integrations")
    .select("business_id, test_mode, api_key_encrypted")
    .eq("channel", "VIATOR")
    .eq("enabled", true);

  var results: any[] = [];
  var now = new Date();
  var ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60_000).toISOString();

  for (var i = 0; i < (integrations || []).length; i++) {
    var integ: any = integrations![i];
    try {
      var { data: creds } = await db.rpc("get_ota_credentials", {
        p_business_id: integ.business_id,
        p_key: SETTINGS_ENCRYPTION_KEY,
        p_channel: "VIATOR",
      });
      var credRow = Array.isArray(creds) ? creds[0] : creds;
      if (!credRow?.api_key) {
        console.warn("VIATOR_SYNC: no api_key for biz=" + integ.business_id);
        continue;
      }

      var client = createViatorClient({ apiKey: credRow.api_key, testMode: !!integ.test_mode });

      var { data: mappings } = await db.from("ota_product_mappings")
        .select("external_product_code, external_option_code, tour_id, default_markup_pct")
        .eq("business_id", integ.business_id)
        .eq("channel", "VIATOR")
        .eq("enabled", true);

      for (var j = 0; j < (mappings || []).length; j++) {
        var m: any = mappings![j];
        var { data: slots } = await db.from("slots")
          .select("start_time, capacity_total, booked, held, base_price, status")
          .eq("business_id", integ.business_id)
          .eq("tour_id", m.tour_id)
          .gte("start_time", now.toISOString())
          .lte("start_time", ninetyDaysOut)
          .eq("status", "OPEN");

        var schedules = (slots || []).map((s: any) => {
          var available = Math.max(0, (s.capacity_total || 0) - (s.booked || 0) - (s.held || 0));
          var basePrice = Number(s.base_price || 0);
          var markupPct = Number(m.default_markup_pct || 0);
          var listingPrice = basePrice * (1 + markupPct / 100);
          return {
            date: new Date(s.start_time).toISOString().slice(0, 10),
            startTime: new Date(s.start_time).toISOString().slice(11, 16),
            available,
            price: { amount: Math.round(listingPrice * 100) / 100, currency: "ZAR" },
          };
        });

        if (schedules.length === 0) continue;

        var payload: any = {
          productCode: m.external_product_code,
          schedules,
        };
        if (m.external_option_code) payload.productOptionCode = m.external_option_code;

        await viatorPushAvailability(client, payload);
        results.push({ business_id: integ.business_id, productCode: m.external_product_code, slots: schedules.length });
      }

      await db.from("ota_integrations").update({
        last_sync_at: now.toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
      }).eq("business_id", integ.business_id).eq("channel", "VIATOR");

    } catch (err: any) {
      console.error("VIATOR_SYNC_ERR biz=" + integ.business_id, err?.message || err);
      await db.from("ota_integrations").update({
        last_sync_status: "error",
        last_sync_error: err instanceof Error ? err.message : String(err),
      }).eq("business_id", integ.business_id).eq("channel", "VIATOR");
      results.push({ business_id: integ.business_id, error: err?.message || String(err) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: headers() });
}));
