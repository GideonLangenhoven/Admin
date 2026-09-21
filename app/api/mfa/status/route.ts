import { NextRequest, NextResponse } from "next/server";
import { inspectSensitiveMfa } from "../../../lib/mfa-sensitive";

export async function GET(req: NextRequest) {
  const result = await inspectSensitiveMfa(req, { allowedRoles: ["OPERATOR", "ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"] });
  if (!result.ok) return NextResponse.json({ error: result.code, message: result.message }, { status: result.status });
  return NextResponse.json({
    enrolled: result.verifiedFactors.length > 0,
    currentLevel: result.currentLevel,
    ready: result.ready,
    recoveryState: result.recoveryState,
    reEnrollRequired: result.reEnrollRequired,
  });
}
