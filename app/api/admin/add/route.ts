import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import { getCallerAdmin, isPrivilegedRole } from "../../../lib/api-auth";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller || !isPrivilegedRole(caller.role)) {
    return NextResponse.json({ error: "MAIN_ADMIN or SUPER_ADMIN required" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const businessId = String(body.business_id || "").trim();

  if (!name || !email) {
    return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
  }
  if (!businessId) {
    return NextResponse.json({ error: "business_id is required" }, { status: 400 });
  }

  if (caller.role !== "SUPER_ADMIN" && caller.business_id !== businessId) {
    return NextResponse.json({ error: "Cannot add admins to another business" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey || serviceKey.length < 40) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tempHash = sha256(randomBytes(24).toString("hex"));

  const { data: inserted, error: insertErr } = await admin
    .from("admin_users")
    .insert({
      name,
      email,
      password_hash: tempHash,
      role: "ADMIN",
      business_id: businessId,
      must_set_password: true,
      password_set_at: null,
    })
    .select("id, email, name")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, admin: inserted });
}
