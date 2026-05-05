import { createClient } from "@supabase/supabase-js";

export type CallerAdmin = {
  id: string;
  role: string;
  business_id: string;
};

export async function getCallerAdmin(req: Request): Promise<CallerAdmin | null> {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey || serviceKey.length < 40) return null;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: adminRow } = await admin
    .from("admin_users")
    .select("id, role, business_id, suspended")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!adminRow || adminRow.suspended) return null;
  return { id: adminRow.id, role: adminRow.role, business_id: adminRow.business_id };
}

export function isPrivilegedRole(role: string): boolean {
  return role === "MAIN_ADMIN" || role === "SUPER_ADMIN";
}
