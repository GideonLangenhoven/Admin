import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";
import { withSentry } from "../_shared/sentry.ts";
import { createGygClient, gygPushAvailability } from "../_shared/getyourguide.ts";

const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";
const db = createServiceClient();

function headers() {
  return { "Content-Type": "application/json" };
}

Deno.serve(withSentry("getyourguide-availability-sync", async () => {
  if (!SETTINGS_ENCRYPTION_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "SETTINGS_ENCRYPTION_KEY not set" }), { status: 503, headers: headers() });
  }

  const { data: integrations } = await db.from("ota_integrations")
    .select("business_id, test_mode, api_key_encrypted")
    .eq("channel", "GETYOURGUIDE")
    .eq("enabled", true);

  const results: any[] = [];
  const now = new Date();
  const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60_000).toISOString();

  for (let i = 0; i < (integrations || []).length; i++) {
    const integ: any = integrations![i];
    try {
      const { data: creds } = await db.rpc("get_ota_credentials", {
        p_business_id: integ.business_id,
        p_key: SETTINGS_ENCRYPTION_KEY,
        p_channel: "GETYOURGUIDE",
      });
      const credRow = Array.isArray(creds) ? creds[0] : creds;
      if (!credRow?.api_key || !credRow?.api_secret) {
        console.warn("GYG_SYNC: no credentials for biz=" + integ.business_id);
        continue;
      }

      const client = createGygClient({ clientId: credRow.api_key, clientSecret: credRow.api_secret, testMode: !!integ.test_mode });

      const { data: mappings } = await db.from("ota_product_mappings")
        .select("external_product_code, external_option_code, tour_id, default_markup_pct")
        .eq("business_id", integ.business_id)
        .eq("channel", "GETYOURGUIDE")
        .eq("enabled", true);

      for (let j = 0; j < (mappings || []).length; j++) {
        const m: any = mappings![j];
        const { data: slots } = await db.from("slots")
          .select("start_time, capacity_total, booked, held, base_price, status")
          .eq("business_id", integ.business_id)
          .eq("tour_id", m.tour_id)
          .gte("start_time", now.toISOString())
          .lte("start_time", ninetyDaysOut)
          .eq("status", "OPEN");

        const availabilities = (slots || []).map((s: any) => {
          const available = Math.max(0, (s.capacity_total || 0) - (s.booked || 0) - (s.held || 0));
          const basePrice = Number(s.base_price || 0);
          const markupPct = Number(m.default_markup_pct || 0);
          const listingPrice = basePrice * (1 + markupPct / 100);
          return {
            date: new Date(s.start_time).toISOString().slice(0, 10),
            start_time: new Date(s.start_time).toISOString().slice(11, 16),
            vacancies: available,
            retail_price: { amount: Math.round(listingPrice * 100) / 100, currency: "ZAR" },
          };
        });

        if (availabilities.length === 0) continue;

        const payload: any = {
          product_id: m.external_product_code,
          availabilities,
        };
        if (m.external_option_code) payload.option_id = m.external_option_code;

        await gygPushAvailability(client, payload);
        results.push({ business_id: integ.business_id, product_id: m.external_product_code, slots: availabilities.length });
      }

      await db.from("ota_integrations").update({
        last_sync_at: now.toISOString(),
        last_sync_status: "ok",
        last_sync_error: null,
      }).eq("business_id", integ.business_id).eq("channel", "GETYOURGUIDE");

    } catch (err: any) {
      console.error("GYG_SYNC_ERR biz=" + integ.business_id, err?.message || err);
      await db.from("ota_integrations").update({
        last_sync_status: "error",
        last_sync_error: err instanceof Error ? err.message : String(err),
      }).eq("business_id", integ.business_id).eq("channel", "GETYOURGUIDE");
      results.push({ business_id: integ.business_id, error: err?.message || String(err) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: headers() });
}));
