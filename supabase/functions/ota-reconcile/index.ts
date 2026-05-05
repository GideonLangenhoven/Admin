import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";
import { withSentry } from "../_shared/sentry.ts";
import { createViatorClient } from "../_shared/viator.ts";
import { createGygClient, gygFetchBookings } from "../_shared/getyourguide.ts";

const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";
const db = createServiceClient();

function headers() {
  return { "Content-Type": "application/json" };
}

type Drift = {
  type: "missing_locally" | "missing_on_ota" | "amount_mismatch" | "status_mismatch";
  external_ref: string;
  detail: string;
  our_booking_id?: string;
};

Deno.serve(withSentry("ota-reconcile", async () => {
  if (!SETTINGS_ENCRYPTION_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "SETTINGS_ENCRYPTION_KEY not set" }), { status: 503, headers: headers() });
  }

  const { data: integrations } = await db.from("ota_integrations")
    .select("business_id, channel, test_mode")
    .eq("enabled", true);

  const now = new Date();
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60_000);
  const results: any[] = [];

  for (let i = 0; i < (integrations || []).length; i++) {
    const integ: any = integrations![i];
    try {
      const { data: creds } = await db.rpc("get_ota_credentials", {
        p_business_id: integ.business_id,
        p_key: SETTINGS_ENCRYPTION_KEY,
        p_channel: integ.channel,
      });
      const credRow = Array.isArray(creds) ? creds[0] : creds;
      if (!credRow?.api_key) continue;

      let otaBookings: any[] = [];
      try {
        otaBookings = await fetchOtaBookings(integ.channel, credRow, integ.test_mode, fortyEightHoursAgo.toISOString());
      } catch (fetchErr: any) {
        console.warn("OTA_RECONCILE: failed to fetch from " + integ.channel + " biz=" + integ.business_id + ": " + fetchErr?.message);
        await db.from("ota_reconciliation_runs").insert({
          business_id: integ.business_id,
          channel: integ.channel,
          period_start: fortyEightHoursAgo.toISOString(),
          period_end: now.toISOString(),
          status: "fetch_error",
          drifts: [{ type: "missing_locally", external_ref: "", detail: "Failed to fetch OTA bookings: " + (fetchErr?.message || String(fetchErr)) }],
        });
        results.push({ business_id: integ.business_id, channel: integ.channel, status: "fetch_error" });
        continue;
      }

      const { data: ourBookings } = await db.from("bookings")
        .select("id, ota_external_booking_id, ota_net_amount, ota_gross_amount, status, qty")
        .eq("business_id", integ.business_id)
        .eq("ota_channel", integ.channel)
        .gte("created_at", fortyEightHoursAgo.toISOString())
        .not("ota_external_booking_id", "is", null);

      const ourMap = new Map<string, any>();
      (ourBookings || []).forEach((b: any) => { if (b.ota_external_booking_id) ourMap.set(b.ota_external_booking_id, b); });

      const otaMap = new Map<string, any>();
      otaBookings.forEach((b: any) => {
        const ref = extractOtaRef(integ.channel, b);
        if (ref) otaMap.set(ref, b);
      });

      const drifts: Drift[] = [];
      let matched = 0;

      otaMap.forEach((otaB, ref) => {
        const ours = ourMap.get(ref);
        if (!ours) {
          drifts.push({ type: "missing_locally", external_ref: ref, detail: "Booking exists on " + integ.channel + " but not in our DB" });
          return;
        }
        matched++;
        const otaNet = extractOtaNetAmount(integ.channel, otaB);
        if (otaNet !== null && Math.abs(otaNet - Number(ours.ota_net_amount || 0)) > 0.01) {
          drifts.push({
            type: "amount_mismatch", external_ref: ref, our_booking_id: ours.id,
            detail: "Net amount: ours=" + ours.ota_net_amount + " OTA=" + otaNet,
          });
        }
        const otaStatus = extractOtaStatus(integ.channel, otaB);
        const ourStatus = ours.status;
        if (otaStatus === "CANCELLED" && ourStatus !== "CANCELLED") {
          drifts.push({
            type: "status_mismatch", external_ref: ref, our_booking_id: ours.id,
            detail: "OTA says cancelled, we say " + ourStatus,
          });
        } else if (otaStatus !== "CANCELLED" && ourStatus === "CANCELLED") {
          drifts.push({
            type: "status_mismatch", external_ref: ref, our_booking_id: ours.id,
            detail: "We say cancelled, OTA says " + otaStatus,
          });
        }
      });

      ourMap.forEach((ours, ref) => {
        if (!otaMap.has(ref) && ours.status !== "CANCELLED") {
          drifts.push({ type: "missing_on_ota", external_ref: ref, our_booking_id: ours.id, detail: "Booking in our DB but not found on " + integ.channel });
        }
      });

      const run = {
        business_id: integ.business_id,
        channel: integ.channel,
        period_start: fortyEightHoursAgo.toISOString(),
        period_end: now.toISOString(),
        our_count: ourMap.size,
        ota_count: otaMap.size,
        matched,
        missing_locally: drifts.filter(d => d.type === "missing_locally").length,
        missing_on_ota: drifts.filter(d => d.type === "missing_on_ota").length,
        amount_mismatches: drifts.filter(d => d.type === "amount_mismatch").length,
        status_mismatches: drifts.filter(d => d.type === "status_mismatch").length,
        drifts: JSON.stringify(drifts),
        status: drifts.length > 0 ? "drift" : "ok",
      };

      await db.from("ota_reconciliation_runs").insert(run);
      results.push({ business_id: integ.business_id, channel: integ.channel, status: run.status, drifts: drifts.length });

      if (drifts.length > 0) {
        await db.from("logs").insert({
          business_id: integ.business_id,
          event: "ota_reconcile_drift",
          payload: { channel: integ.channel, drifts: drifts.length, run_status: run.status },
        });
      }

    } catch (err: any) {
      console.error("OTA_RECONCILE_ERR biz=" + integ.business_id + " ch=" + integ.channel, err?.message || err);
      results.push({ business_id: integ.business_id, channel: integ.channel, error: err?.message || String(err) });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers: headers() });
}));

async function fetchOtaBookings(channel: string, creds: any, testMode: boolean, since: string): Promise<any[]> {
  if (channel === "VIATOR") {
    const client = createViatorClient({ apiKey: creds.api_key, testMode: !!testMode });
    const r = await client.fetch("/bookings?modifiedSince=" + encodeURIComponent(since));
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error("Viator bookings fetch: " + r.status + " " + body);
    }
    const data = await r.json();
    return data?.bookings || data?.data || [];
  }
  if (channel === "GETYOURGUIDE") {
    const gygClient = createGygClient({ clientId: creds.api_key, clientSecret: creds.api_secret, testMode: !!testMode });
    return await gygFetchBookings(gygClient, since);
  }
  return [];
}

function extractOtaRef(channel: string, booking: any): string {
  if (channel === "VIATOR") return String(booking?.bookingRef || booking?.bookingReference || booking?.data?.bookingRef || "");
  if (channel === "GETYOURGUIDE") return String(booking?.booking_reference || booking?.booking_id || "");
  return "";
}

function extractOtaNetAmount(channel: string, booking: any): number | null {
  if (channel === "VIATOR") {
    const v = booking?.totalNetPrice?.amount || booking?.netRate?.amount || booking?.supplierPrice;
    return v != null ? Number(v) : null;
  }
  if (channel === "GETYOURGUIDE") {
    const g = booking?.price?.net?.amount || booking?.net_price?.amount;
    return g != null ? Number(g) : null;
  }
  return null;
}

function extractOtaStatus(channel: string, booking: any): string {
  let status = "";
  if (channel === "VIATOR") status = String(booking?.status || booking?.bookingStatus || "").toUpperCase();
  if (channel === "GETYOURGUIDE") status = String(booking?.status || booking?.booking_status || "").toUpperCase();
  if (status.includes("CANCEL")) return "CANCELLED";
  if (status.includes("CONFIRM") || status.includes("ACCEPT")) return "CONFIRMED";
  return status;
}
