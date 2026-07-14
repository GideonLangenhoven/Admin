// Client-safe constant — no Supabase import, mirrors role-utils.ts.
// These admin_users rows belong to the platform superadmin (same person,
// two emails as a backup) and must never appear in an operator's own
// team/admin list or count against that operator's seat limit.
export const HIDDEN_SUPERADMIN_EMAILS = ["gidslang89@gmail.com", "info@capeweb.co.za"];
