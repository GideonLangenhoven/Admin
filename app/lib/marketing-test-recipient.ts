// Resolves who a "send me a test" marketing email should go to. Priority:
//  1. The currently logged-in admin (localStorage) — most likely what an
//     operator clicking "test" actually wants.
//  2. businesses.marketing_test_email — explicit per-tenant override for
//     unattended automation (e.g. a shared marketing inbox).
//  3. First MAIN_ADMIN/SUPER_ADMIN on the business as a last resort.
// Extracted from app/marketing/templates/page.tsx so the automation editor's
// "Email me all steps" test send resolves the same recipient the template
// editor's "Send test" already does, instead of re-deriving it.
export async function resolveMarketingTestRecipient(
  supabase: any,
  businessId: string,
): Promise<{ email: string; name: string }> {
  let email = localStorage.getItem("ck_admin_email") || "";
  let name = localStorage.getItem("ck_admin_name") || "Admin";
  if (email) return { email, name };

  const { data: biz } = await supabase
    .from("businesses")
    .select("marketing_test_email")
    .eq("id", businessId)
    .maybeSingle();
  if (biz?.marketing_test_email) {
    email = biz.marketing_test_email;
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("name")
      .eq("email", email)
      .eq("business_id", businessId)
      .maybeSingle();
    return { email, name: adminRow?.name || "Admin" };
  }

  const { data: fallbackAdmin } = await supabase
    .from("admin_users")
    .select("email, name")
    .eq("business_id", businessId)
    .in("role", ["MAIN_ADMIN", "SUPER_ADMIN"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (fallbackAdmin?.email) {
    email = fallbackAdmin.email;
    name = fallbackAdmin.name || "Admin";
    localStorage.setItem("ck_admin_email", email);
    if (fallbackAdmin.name) localStorage.setItem("ck_admin_name", fallbackAdmin.name);
  }
  return { email, name };
}
