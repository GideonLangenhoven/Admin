import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceExports, sourceHandler } from "../helpers/source-handler";

// S5 (security test I): every verify_jwt = false function is on a reviewed list with its authentication
// method, and the three functions the review found open (or fail-open) now reject unauthenticated callers.

const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2";
const ENV = { SUPABASE_URL: "https://fn.invalid", SUPABASE_SERVICE_ROLE_KEY: "service-key-fixture" };

function noJwtFunctions(): string[] {
  const out: string[] = [];
  let current = "";
  for (const line of readFileSync("supabase/config.toml", "utf8").split("\n")) {
    const header = line.match(/^\[functions\.([a-z0-9-]+)\]/);
    if (header) current = header[1];
    if (current && /verify_jwt\s*=\s*false/.test(line)) { out.push(current); current = ""; }
  }
  return out.sort();
}

describe("verify_jwt = false review", () => {
  const review = JSON.parse(readFileSync("supabase/functions-auth-review.json", "utf8"));
  const reviewed = Object.keys(review.functions).sort();

  it("lists exactly the functions that skip the gateway JWT check (a new one needs a reviewed entry)", () => {
    expect(reviewed).toEqual(noJwtFunctions());
  });

  it.each(reviewed)("%s: its source contains the reviewed authentication marker", (fn) => {
    const entry = review.functions[fn];
    expect(Object.keys(review.mechanisms), fn).toContain(entry.auth);
    const source = readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");
    expect(source, `${fn} (${entry.auth}) must contain /${entry.marker}/i`).toMatch(new RegExp(entry.marker, "i"));
  });

  it("keeps the credential-free list short and deliberate", () => {
    const open = reviewed.filter((fn) => review.functions[fn].auth === "public-by-design");
    expect(open).toEqual(["marketing-track", "web-chat"]);
  });

  it("OTA delegates fail closed: supplier auth and a service-key gate live in ota-runtime", () => {
    const runtime = readFileSync("supabase/functions/_shared/ota-runtime.ts", "utf8");
    expect(runtime).toContain("AUTHORIZATION_FAILURE");
    expect(runtime).toMatch(/equalSecret\(\s*req\.headers\.get\("authorization"\) \|\| "",\s*"Bearer " \+ key/);
  });
});

function authFor(db: unknown, env: Record<string, string> = {}) {
  return sourceExports("supabase/functions/_shared/auth.ts", { [SUPABASE_JS]: { createClient: () => db } }, { ...ENV, ...env });
}
const anything: any = new Proxy(() => anything, { get: (_t, p) => (p === "then" ? (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res) : () => anything), apply: () => anything });
const request = (headers: Record<string, string> = {}, method = "POST") => new Request("https://fn.invalid/", { method, headers, body: method === "POST" ? "{}" : undefined });

describe("fetch-google-reviews (was callable by anyone, spending Google Places quota)", () => {
  const handler = (env: Record<string, string> = {}) =>
    sourceHandler(
      "supabase/functions/fetch-google-reviews/index.ts",
      { "../_shared/tenant.ts": { createServiceClient: () => anything, fetchAllRows: async () => [] }, "../_shared/auth.ts": authFor(anything, env) },
      { ...ENV, ...env },
    );

  it("rejects a caller with no credentials", async () => expect((await handler()(request())).status).toBe(401));
  it("rejects a wrong key", async () => expect((await handler()(request({ apikey: "not-the-key" }))).status).toBe(401));
  it("accepts the service key as the apikey header (how pg_cron sends it)", async () => {
    expect((await handler()(request({ apikey: "service-key-fixture" }))).status).toBe(503); // authorised; stops at the unset Places key
  });
  it("accepts the service key as a bearer token", async () => {
    expect((await handler()(request({ authorization: "Bearer service-key-fixture" }))).status).toBe(503);
  });
});

describe("kb-sync (used to allow everyone when KB_SYNC_KEY was unset)", () => {
  const handler = (env: Record<string, string> = {}) =>
    sourceHandler(
      "supabase/functions/kb-sync/index.ts",
      {
        [SUPABASE_JS]: { createClient: () => anything },
        "../_shared/kb.ts": { embedText: async () => [], sha256Hex: async () => "hash" },
        "../_shared/auth.ts": authFor(anything, env),
      },
      { ...ENV, ...env },
    );
  const call = (env: Record<string, string>, headers: Record<string, string> = {}) => handler(env)(request(headers)).then((r) => r.status);

  it("rejects everyone when no shared secret is configured (fail closed)", async () => {
    expect(await call({})).toBe(401);
    expect(await call({}, { "x-kb-sync-key": "" })).toBe(401);
  });
  it("rejects a wrong or partial shared secret", async () => {
    expect(await call({ KB_SYNC_KEY: "sync-secret" }, { "x-kb-sync-key": "sync-secre" })).toBe(401);
    expect(await call({ KB_SYNC_KEY: "sync-secret" })).toBe(401);
  });
  it("accepts the right shared secret", async () => expect(await call({ KB_SYNC_KEY: "sync-secret" }, { "x-kb-sync-key": "sync-secret" })).not.toBe(401));
  it("accepts the service key even when the shared secret is unset", async () => {
    expect(await call({}, { apikey: "service-key-fixture" })).not.toBe(401);
  });
});

describe("billing-enforcement (constant-time comparisons)", () => {
  const handler = (env: Record<string, string> = {}) =>
    sourceHandler(
      "supabase/functions/billing-enforcement/index.ts",
      { "../_shared/tenant.ts": { createServiceClient: () => anything }, "../_shared/auth.ts": authFor(anything, env) },
      { ...ENV, ...env },
    );
  const call = (env: Record<string, string>, headers: Record<string, string> = {}) => handler(env)(request(headers)).then((r) => r.status);

  it("rejects no credentials, and a key that is only a prefix of the secret", async () => {
    expect(await call({ BILLING_ENFORCEMENT_KEY: "billing-secret" })).toBe(401);
    expect(await call({ BILLING_ENFORCEMENT_KEY: "billing-secret" }, { "x-billing-key": "billing-secre" })).toBe(401);
  });
  it("never treats an empty key as matching an unset secret", async () => {
    expect(await call({}, { "x-billing-key": "" })).toBe(401);
  });
  it("accepts the shared secret and the service-key bearer", async () => {
    expect(await call({ BILLING_ENFORCEMENT_KEY: "billing-secret" }, { "x-billing-key": "billing-secret" })).not.toBe(401);
    expect(await call({}, { authorization: "Bearer service-key-fixture" })).not.toBe(401);
  });
  it("source no longer compares secrets with ===", () => {
    const src = readFileSync("supabase/functions/billing-enforcement/index.ts", "utf8");
    expect(src).not.toMatch(/===\s*ENFORCEMENT_KEY|bearer\s*===\s*SUPABASE_KEY/);
  });
});

describe("CORS origin allowlist", () => {
  const origins = (env: Record<string, string> = {}) => {
    const t = sourceExports("supabase/functions/_shared/tenant.ts", { [SUPABASE_JS]: { createClient: () => anything }, "./pagination.ts": { fetchAllRows: async () => [] } }, { ...ENV, ...env }) as any;
    return (origin: string) => t.isAllowedOrigin(origin, t.getAdminAppOrigins()) as boolean;
  };
  const production = origins();
  const staging = origins({ ALLOW_DEV_ORIGINS: "true" });

  it.each(["https://admin.bookingtours.co.za", "https://acme.booking.bookingtours.co.za", "https://acme.admin.bookingtours.co.za", "https://bookingtours.co.za", "https://caepweb-admin.vercel.app"])(
    "production allows %s", (o) => expect(production(o)).toBe(true));

  it.each([
    "http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001", "https://evil.example",
    "http://acme.booking.bookingtours.co.za",            // not https
    "https://evilbookingtours.co.za", "https://bookingtours.co.za.evil.example",
    "https://caepweb-admin-abc123xyz-jerrys-projects-f4e4eaf9.vercel.app", // a real preview: staging only
    "https://x-jerrys-projects-f4e4eaf9.vercel.app",
    "https://booking-abc123xyz-evil-jerrys-projects-f4e4eaf9.vercel.app",  // another team whose slug ends the same way
  ])("production rejects %s", (o) => expect(production(o)).toBe(false));

  it("staging (ALLOW_DEV_ORIGINS=true) adds localhost and the app's own preview deployments only", () => {
    expect(staging("http://localhost:3000")).toBe(true);
    expect(staging("https://caepweb-admin-abc123xyz-jerrys-projects-f4e4eaf9.vercel.app")).toBe(true);
    expect(staging("https://booking-abc123xyz-jerrys-projects-f4e4eaf9.vercel.app")).toBe(true);
    expect(staging("https://booking-abc123xyz-evil-jerrys-projects-f4e4eaf9.vercel.app")).toBe(false);
    expect(staging("https://anything-jerrys-projects-f4e4eaf9.vercel.app")).toBe(false);
    expect(staging("https://evil.example")).toBe(false);
  });
});
