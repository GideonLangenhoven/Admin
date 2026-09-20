import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { sourceExports } from "../helpers/source-handler";

describe("shared demo account boundaries", () => {
  it("allows API reads and rejects API writes before service-role work", async () => {
    const row = {
      id: "demo",
      role: "SUPER_ADMIN",
      business_id: "business",
      suspended: false,
      read_only: true,
    };
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: row, error: null }),
    };
    const auth = sourceExports("app/lib/api-auth.ts", {
      "@supabase/supabase-js": {
        createClient: () => ({
          auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
          from: () => q,
        }),
      },
      "./role-utils": {},
    }).getCallerAdmin as (request: Request) => Promise<unknown>;

    const headers = { authorization: "Bearer fixture" };
    expect(
      await auth(
        new Request("https://test.invalid", { method: "GET", headers }),
      ),
    ).toMatchObject({ id: "demo" });
    expect(
      await auth(
        new Request("https://test.invalid", { method: "POST", headers }),
      ),
    ).toBeNull();
  });

  it("never lets a read-only role override its bound tenant through the shared API helper", async () => {
    const ownBusiness = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const foreignBusiness = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let row = {
      id: "demo",
      role: "SUPER_ADMIN",
      business_id: ownBusiness,
      suspended: false,
      read_only: true,
    };
    const createClient = () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
      from: (table: string) => {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => table === "admin_users"
            ? { data: { ...row }, error: null }
            : { data: { id: foreignBusiness }, error: null },
        };
        return q;
      },
    });
    const auth = sourceExports("app/lib/api-auth.ts", {
      "@supabase/supabase-js": { createClient },
      "./role-utils": {},
    }).getCallerAdmin as (request: Request) => Promise<Record<string, unknown> | null>;
    const request = (target?: string) => new Request("https://test.invalid", {
      method: "GET",
      headers: {
        authorization: "Bearer fixture",
        cookie: "ck_demo_read_only=0",
        ...(target ? { "x-admin-business-id": target } : {}),
      },
    });

    const readOnlyCaller = await auth(request());
    expect(readOnlyCaller).toMatchObject({ business_id: ownBusiness, role: "MAIN_ADMIN" });
    await expect(auth(request(foreignBusiness))).resolves.toBeNull();

    row = { ...row, read_only: false };
    const writableCaller = await auth(request());
    expect(writableCaller).toMatchObject({ business_id: ownBusiness, role: "SUPER_ADMIN" });
    await expect(auth(request(foreignBusiness))).resolves.toMatchObject({ business_id: foreignBusiness });

    async function otaGet(caller: Record<string, unknown> | null, businessId: string) {
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      const serviceClient = vi.fn(() => ({ from: () => query }));
      const route = sourceExports("app/api/ota/route.ts", {
        "@supabase/supabase-js": { createClient: serviceClient },
        "../../lib/api-auth": {
          getCallerAdmin: async () => caller,
          isPrivilegedRole: (role: string) => role === "MAIN_ADMIN" || role === "SUPER_ADMIN",
        },
        "../../../supabase/functions/_shared/ota-readiness": {
          OTA_DIRECT_CONNECTIONS_AVAILABLE: false,
          OTA_UNAVAILABLE_MESSAGE: "Not available",
        },
      }).GET as (request: Request & { nextUrl: URL }) => Promise<Response>;
      const url = new URL("https://test.invalid/api/ota?business_id=" + businessId + "&channel=VIATOR");
      const routeRequest = Object.assign(new Request(url), { nextUrl: url });
      return { response: await route(routeRequest), serviceClient };
    }

    const denied = await otaGet(readOnlyCaller, foreignBusiness);
    expect(denied.response.status).toBe(403);
    expect(denied.serviceClient).not.toHaveBeenCalled();
    const own = await otaGet(readOnlyCaller, ownBusiness);
    expect(own.response.status).toBe(200);
    expect(own.serviceClient).toHaveBeenCalledOnce();
    const support = await otaGet(writableCaller, foreignBusiness);
    expect(support.response.status).toBe(200);
    expect(support.serviceClient).toHaveBeenCalledOnce();
  });

  it("rejects demo sessions at the shared Edge-function boundary", async () => {
    const q: any = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({
        data: {
          business_id: "business",
          role: "SUPER_ADMIN",
          suspended: false,
          read_only: true,
        },
      }),
    };
    const edgeAuth = sourceExports("supabase/functions/_shared/auth.ts", {
      "https://esm.sh/@supabase/supabase-js@2": {
        createClient: () => ({
          auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
          from: () => q,
        }),
      },
    });
    const requireAuth = edgeAuth.requireAuth as (
      request: Request,
      options?: { allowReadOnly?: boolean },
    ) => Promise<{ businessId: string; role: string; readOnly: boolean }>;
    const canAccessBusiness = edgeAuth.canAccessBusiness as (
      auth: { businessId: string; role: string; isServiceRole: boolean; readOnly: boolean },
      businessId: string,
    ) => boolean;

    await expect(
      requireAuth(
        new Request("https://test.invalid", {
          headers: { authorization: "Bearer fixture" },
        }),
      ),
    ).rejects.toThrow("read-only");
    const allowedDemo = await requireAuth(
        new Request("https://test.invalid", {
          headers: { authorization: "Bearer fixture" },
        }),
        { allowReadOnly: true },
      );
    expect(allowedDemo).toMatchObject({ readOnly: true, role: "MAIN_ADMIN" });
    expect(canAccessBusiness({ ...allowedDemo, role: "SUPER_ADMIN", isServiceRole: false }, "business")).toBe(true);
    expect(canAccessBusiness({ ...allowedDemo, role: "SUPER_ADMIN", isServiceRole: false }, "foreign")).toBe(false);
    expect(canAccessBusiness({
      businessId: "business",
      role: "SUPER_ADMIN",
      isServiceRole: false,
      readOnly: false,
    }, "foreign")).toBe(true);
    expect(canAccessBusiness({
      businessId: "",
      role: "service_role",
      isServiceRole: true,
      readOnly: false,
    }, "foreign")).toBe(true);
    expect(canAccessBusiness({
      businessId: "",
      role: "service_role",
      isServiceRole: true,
      readOnly: false,
    }, "")).toBe(false);
  });

  it("keeps the AI guide available while replacing blanket form disabling", () => {
    const shell = readFileSync("components/AppShell.tsx", "utf8");
    expect(shell).toContain("<HelpChat />");
    expect(shell).toContain("<DemoActionGuide>{children}</DemoActionGuide>");
    expect(shell).not.toContain("<fieldset disabled");
    expect(shell).toContain("yocoTestMode && !readOnly");
    expect(shell).toContain("n.demoOnly && !readOnly");
  });

  it("links the guided demo to Claire's real customer booking site", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    const shell = readFileSync("components/AppShell.tsx", "utf8");
    const drawer = readFileSync("components/MobileMenuDrawer.tsx", "utf8");
    expect(layout).toContain('label: "Booking Site"');
    expect(layout).toContain("DEMO_BOOKING_SITE_URL");
    expect(shell).toContain("View Claire&apos;s booking site ↗");
    expect(shell).toContain('target={n.external ? "_blank" : undefined}');
    expect(drawer).toContain('target={n.external ? "_blank" : undefined}');
  });

  it("keeps the demo chatbot tour and applies the demo route exclusions", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    for (const route of [
      "/guide",
      "/photos",
      "/customers",
      "/notifications",
      "/settings/ota",
    ]) {
      expect(layout).toContain(`href: "${route}"`);
    }
    const chat = readFileSync("components/HelpChat.tsx", "utf8");
    expect(chat).toContain("Show me every part of the operator system");
    expect(chat).toContain("DEMO_SUGGESTED");
    const edge = readFileSync(
      "supabase/functions/admin-help-chat/index.ts",
      "utf8",
    );
    expect(edge).toContain("Show off the features included in this demo");
    expect(edge).toContain("hits.filter(hit => !hit.route || isDemoPathVisible(hit.route))");
    expect(chat).toContain("!readOnly || isDemoPathVisible(openPath)");
    expect(edge).toContain("hits.length === 0 && !auth.readOnly");
  });

  it("blocks direct public-table and Storage writes in the database", () => {
    const migration = readFileSync(
      "supabase/migrations/20260914190000_demo_account_read_only.sql",
      "utf8",
    );
    expect(migration).toContain("before insert or update or delete");
    expect(migration).toContain("where user_id = (select auth.uid())");
    expect(migration).toContain("on storage.objects");
  });

  it("refreshes Claire's synthetic dates after a successful demo login", () => {
    const login = readFileSync("app/api/admin/login/route.ts", "utf8");
    expect(login).toContain("if (user.read_only)");
    expect(login).toContain('"refresh_claires_hiking_demo_dates"');

    const migration = readFileSync(
      "supabase/migrations/20260916100000_expand_claires_demo_fixture.sql",
      "utf8",
    );
    expect(migration).toContain("subdomain = 'claires-hiking'");
    expect(migration).toContain("at time zone 'Africa/Johannesburg'");
    expect(migration).toContain("000000000203'::uuid, 0, '17:30'::time");
    expect(migration).toContain("000000000204'::uuid, 0, '07:00'::time");
    expect(migration).toContain("000000000234'::uuid, 30, '17:00'::time");
    expect(migration).toContain("000000000350'::uuid, -1, '15:00'::time");
    expect(migration).toContain("update public.customers as customer");
    expect(migration).toContain("to service_role");

    const schedule = readFileSync(
      "supabase/migrations/20260917090000_schedule_claires_demo_refresh.sql",
      "utf8",
    );
    expect(schedule).toContain("refresh-claires-hiking-demo-daily");
    expect(schedule).toContain("'5 22 * * *'");
    expect(schedule).toContain("refresh_claires_hiking_demo_dates");
  });

  it("seeds a full, rolling operator calendar instead of a sparse fixture", () => {
    const script = readFileSync("scripts/provision-demo-account.mjs", "utf8");
    const slots = script.match(/const slotRows = \[([\s\S]*?)\]\.map/);
    const bookings = script.match(/const bookingRows = \[([\s\S]*?)\]\.map/);
    expect(slots).toBeTruthy();
    expect(bookings).toBeTruthy();
    expect([...slots![1].matchAll(/\[\d{3},/g)]).toHaveLength(34);
    expect([...bookings![1].matchAll(/\[\d{3},/g)]).toHaveLength(50);
    expect(script).toContain("Cape Point Coastal Hike");
    expect(script).toContain("Kirstenbosch Morning Walk");
    expect(script).toContain("Seed demo customers");
    expect(script).toContain("Demo fixture needs at least 50 synthetic bookings");
  });

  it("keeps custom money and messaging handlers behind a read-only check", () => {
    for (const file of [
      "app/api/combo-cancel/route.ts",
      "supabase/functions/rebook-booking/index.ts",
      "supabase/functions/process-refund/index.ts",
      "supabase/functions/cancel-booking/index.ts",
      "supabase/functions/combo-settlement-link/index.ts",
      "supabase/functions/bank-details/index.ts",
      "supabase/functions/google-drive/index.ts",
      "supabase/functions/external-booking/index.ts",
    ])
      expect(readFileSync(file, "utf8")).toContain("read_only");
  });
});
