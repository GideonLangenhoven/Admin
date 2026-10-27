import { NextResponse } from "next/server";

function retired() {
  return NextResponse.json({ error: "MFA has been removed. Use your normal sign-in." }, { status: 410 });
}

export const GET = retired;
export const POST = retired;
