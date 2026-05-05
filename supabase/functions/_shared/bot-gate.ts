import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface BotGateResult {
  active: boolean;
  reason: string;
}

export async function shouldBotReply(
  supabase: SupabaseClient,
  businessId: string
): Promise<BotGateResult> {
  const { data: biz } = await supabase
    .from("businesses")
    .select("whatsapp_bot_mode")
    .eq("id", businessId)
    .maybeSingle();

  if (!biz) return { active: false, reason: "no_business" };

  if (biz.whatsapp_bot_mode === "OFF") {
    return { active: false, reason: "mode_off" };
  }

  if (biz.whatsapp_bot_mode === "ALWAYS_ON") {
    return { active: true, reason: "mode_always_on" };
  }

  // OUTSIDE_HOURS — check the RPC
  const { data: insideHours } = await supabase.rpc("is_inside_business_hours", {
    p_business_id: businessId,
  });

  if (insideHours) {
    return { active: false, reason: "inside_business_hours" };
  }
  return { active: true, reason: "outside_business_hours" };
}
