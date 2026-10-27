import { createClient } from "@supabase/supabase-js";
import { requireActiveSubscription, type CallerAdmin } from "./api-auth";

// This identity has no admin_users row and cannot use general dashboard APIs.
export async function getCallerGuide(req: Request): Promise<CallerAdmin | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: guide } = await db.from("guide_accounts").select("id, business_id")
    .eq("user_id", data.user.id).eq("suspended", false).eq("must_set_password", false).maybeSingle();
  if (!guide || (req.headers.get("x-admin-business-id") && req.headers.get("x-admin-business-id") !== guide.business_id)) return null;
  if (!(await requireActiveSubscription(guide.business_id)).active) return null;
  return { id: guide.id, role: "GUIDE", business_id: guide.business_id };
}
