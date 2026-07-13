// Client-safe role check — no Supabase client, no service-role key, no
// server-only imports. Split out of api-auth.ts so client components never
// pull in that file's createClient(url, SUPABASE_SERVICE_ROLE_KEY) call
// graph just to check a role string.
export function isPrivilegedRole(role: string): boolean {
  return role === "MAIN_ADMIN" || role === "SUPER_ADMIN";
}
