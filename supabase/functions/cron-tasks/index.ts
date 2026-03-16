import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, formatTenantDateTime, getTenantByBusinessId, sendWhatsappTextForTenant } from "../_shared/tenant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createServiceClient();

function headers() {
  return { "Content-Type": "application/json" };
}

async function cleanupExpiredHolds() {
  const results = { hold_cleanup: 0 };
  const nowIso = new Date().toISOString();
  const { data: expiredHolds } = await supabase
    .from("holds")
    .select("id, booking_id, slot_id, business_id, bookings(phone), slots(start_time), tours(name)")
    .eq("status", "ACTIVE")
    .lt("expires_at", nowIso);

  for (const hold of expiredHolds || []) {
    await supabase.from("holds").update({ status: "EXPIRED" }).eq("id", hold.id);
    if (hold.bookings?.phone && hold.business_id) {
      try {
        const tenant = await getTenantByBusinessId(supabase, hold.business_id);
        const slotLabel = hold.slots?.start_time ? formatTenantDateTime(tenant.business, hold.slots.start_time) : "your selected slot";
        const message =
          "Your held booking for " + (hold.tours?.name || "the experience") + " at " + slotLabel + " has expired.\n\n" +
          "If you still want those spots, start a new booking and we’ll help from there.";
        await sendWhatsappTextForTenant(tenant, hold.bookings.phone, message);
      } catch (error) {
        console.error("HOLD_EXPIRY_WA_ERR", hold.id, error);
      }
    }
    results.hold_cleanup += 1;
  }

  return results;
}

Deno.serve(async (_req) => {
  const results: any = { reminders: null, hold_cleanup: 0, errors: [] };

  try {
    const reminderRes = await fetch(SUPABASE_URL + "/functions/v1/auto-messages", {
      method: "POST",
      headers: { ...headers(), Authorization: "Bearer " + SUPABASE_KEY },
      body: JSON.stringify({ action: "all" }),
    });
    results.reminders = await reminderRes.json().catch(() => null);
  } catch (error) {
    console.error("AUTO_MESSAGES_INVOKE_ERR", error);
    results.errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const cleanup = await cleanupExpiredHolds();
    results.hold_cleanup = cleanup.hold_cleanup;
  } catch (error) {
    console.error("HOLD_CLEANUP_ERR", error);
    results.errors.push(error instanceof Error ? error.message : String(error));
  }

  return new Response(JSON.stringify(results), { headers: headers(), status: results.errors.length ? 500 : 200 });
});
