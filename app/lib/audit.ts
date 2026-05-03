import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

var url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getClient() {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AuditAction =
  | "ADMIN_LOGIN" | "ADMIN_LOGIN_FAIL"
  | "ADMIN_INVITE" | "ADMIN_RESET_REQUESTED" | "ADMIN_PASSWORD_CHANGED"
  | "ADMIN_DELETED"
  | "TENANT_ONBOARDED"
  | "CREDENTIALS_UPDATED"
  | "BOOKING_CANCELLED"
  | "REFUND_INITIATED" | "REFUND_DECLINED"
  | "TOUR_CREATED" | "TOUR_UPDATED" | "TOUR_DELETED"
  | "SLOT_GENERATED"
  | "SETTINGS_UPDATED"
  | "BROADCAST_SENT"
  | string;

type AuditRecord = {
  business_id: string | null;
  actor_id?: string | null;
  actor_role?: string | null;
  actor_email?: string | null;
  action: AuditAction;
  entity_type?: string;
  entity_id?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  ip_address?: string | null;
  user_agent?: string | null;
  source?: string;
};

export async function audit(rec: AuditRecord): Promise<string | null> {
  try {
    if (!serviceKey || serviceKey.length < 40) return null;
    var { data, error } = await getClient()
      .from("audit_logs")
      .insert({
        business_id: rec.business_id,
        actor_id: rec.actor_id ?? null,
        actor_role: rec.actor_role ?? null,
        actor_email: rec.actor_email ?? null,
        action_type: rec.action,
        target_entity: rec.entity_type ?? null,
        target_id: rec.entity_id ?? null,
        before_state: rec.before ?? null,
        after_state: rec.after ?? null,
        metadata: rec.metadata ?? null,
        ip_address: rec.ip_address ?? null,
        user_agent: rec.user_agent ?? null,
        source: rec.source ?? "api",
      })
      .select("id")
      .single();
    if (error) {
      console.error("[audit] insert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.error("[audit] threw:", e);
    return null;
  }
}

export function callerContext(req: NextRequest, admin: { id: string; role: string; business_id: string; email?: string }) {
  return {
    actor_id: admin.id,
    actor_role: admin.role,
    actor_email: admin.email ?? null,
    business_id: admin.business_id,
    ip_address: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null,
    user_agent: req.headers.get("user-agent") ?? null,
  };
}
