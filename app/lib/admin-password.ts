import type { SupabaseClient } from "@supabase/supabase-js";

// Finish the sign-in password update before changing the legacy login hash or
// consuming a setup link. Supabase returns errors; it does not always throw.
export async function setAdminAuthPassword(
  db: SupabaseClient,
  user: { id: string; email: string; user_id?: string | null; business_id?: string | null; role?: string },
  password: string,
): Promise<string> {
  let userId = user.user_id;
  if (!userId) {
    const { data, error } = await db.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { admin_id: user.id, business_id: user.business_id, role: user.role },
    });
    if (!error) return data.user.id;
    if (error.code !== "email_exists" && error.code !== "user_already_exists") throw error;

    // A previous setup may have created the Auth user without linking it.
    for (let page = 1; !userId; page++) {
      const { data: list, error: listError } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (listError) throw listError;
      userId = list.users.find(candidate => candidate.email?.toLowerCase() === user.email.toLowerCase())?.id;
      if (!userId && list.users.length < 1000) throw error;
    }
  }
  const { error } = await db.auth.admin.updateUserById(userId, { password, email_confirm: true });
  if (error) throw error;
  return userId;
}
