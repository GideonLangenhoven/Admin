// Client-safe role check — no Supabase client, no service-role key, no
// server-only imports. Split out of api-auth.ts so client components never
// pull in that file's createClient(url, SUPABASE_SERVICE_ROLE_KEY) call
// graph just to check a role string.
export function isPrivilegedRole(role: string): boolean {
  return role === "MAIN_ADMIN" || role === "SUPER_ADMIN";
}

// Authorize the persisted target, never a business ID supplied by the caller.
export function canManageAdmin(
  caller: { role: string; business_id: string },
  target: { role: string | null; business_id: string | null },
): boolean {
  if (caller.role === "SUPER_ADMIN") return true;
  return caller.role === "MAIN_ADMIN"
    && Boolean(caller.business_id && target.role)
    && target.business_id === caller.business_id
    && !String(target.role).toUpperCase().startsWith("SUPER");
}
