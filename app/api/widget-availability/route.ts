import { NextRequest, NextResponse } from "next/server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function sbFetch(path: string, options?: RequestInit) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  return res.json();
}

async function sbRpc(fnName: string, args: Record<string, unknown>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${url}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  return res.json();
}

export async function GET(req: NextRequest) {
  const bid = req.nextUrl.searchParams.get("bid");
  if (!bid || !UUID_RE.test(bid)) {
    return NextResponse.json(
      { error: "Invalid or missing business ID" },
      { status: 400, headers: CORS },
    );
  }

  try {
    const now = new Date();
    const fiveDaysOut = new Date(now.getTime() + 5 * 86_400_000);

    const [biz, tours, slots] = await Promise.all([
      sbFetch(
        `businesses?id=eq.${bid}&select=id,name,business_name,timezone,logo_url&limit=1`,
        { headers: { Accept: "application/vnd.pgrst.object+json" } },
      ),
      sbFetch(
        `tours?business_id=eq.${bid}&active=eq.true&hidden=eq.false&select=id,name,base_price_per_person,duration_minutes&order=sort_order`,
      ),
      sbRpc("list_available_slots", {
        p_business_id: bid,
        p_range_start: now.toISOString(),
        p_range_end: fiveDaysOut.toISOString(),
        p_tour_id: null,
      }),
    ]);

    if (!biz || biz.code || biz.message) {
      return NextResponse.json(
        { error: "Business not found", detail: biz?.message },
        { status: 404, headers: CORS },
      );
    }

    return NextResponse.json(
      {
        business: {
          name: biz.business_name || biz.name,
          timezone: biz.timezone || "Africa/Johannesburg",
          logo_url: biz.logo_url || null,
        },
        tours: Array.isArray(tours) ? tours : [],
        slots: (Array.isArray(slots) ? slots : []).map(
          (s: Record<string, unknown>) => ({
            id: s.id,
            tour_id: s.tour_id,
            tour_name: s.tour_name,
            start_time: s.start_time,
            available_capacity: s.available_capacity,
            price:
              (s.price_per_person_override as number | null) ??
              (s.base_price_per_person as number | null),
          }),
        ),
      },
      {
        headers: {
          ...CORS,
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error", detail: String(err) },
      { status: 500, headers: CORS },
    );
  }
}
