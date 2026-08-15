// deno test _shared/onboarding-guards.test.ts
// The onboarding wizard is reachable by anyone holding an invite link, so these
// two guards are the whole trust boundary: what a client may write onto their
// tenant, and what URL we are willing to fetch from inside the cluster.
import {
  isBlockedHost,
  isPrivateAddress,
  normaliseRefundTiers,
  parsePublicUrl,
  pickColumns,
  STEP_COLUMNS,
} from "./onboarding-guards.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

Deno.test("column whitelist drops anything not declared for the step", () => {
  const out = pickColumns("identity", {
    business_name: "Sea Kayak Co",
    subscription_status: "ACTIVE",     // trading gate
    subdomain: "someone-elses",        // tenant identity
    yoco_secret_key_encrypted: "xxx",  // credentials
    id: "00000000-0000-0000-0000-000000000000",
  });
  assert(out.business_name === "Sea Kayak Co", "allowed column kept");
  assert(!("subscription_status" in out), "subscription_status must be dropped");
  assert(!("subdomain" in out), "subdomain must be dropped");
  assert(!("yoco_secret_key_encrypted" in out), "credential column must be dropped");
  assert(!("id" in out), "id must be dropped");
});

Deno.test("no step may write the trading gate, identity or credentials", () => {
  const forbidden = [
    "subscription_status", "subdomain", "booking_site_url", "id", "created_at",
    "yoco_secret_key_encrypted", "yoco_webhook_secret_encrypted",
    "wa_token_encrypted", "wa_phone_id_encrypted", "wa_phone_id_lookup",
    "max_admin_seats", "yoco_webhook_status",
  ];
  for (const [step, cols] of Object.entries(STEP_COLUMNS)) {
    for (const bad of forbidden) {
      assert(!cols.includes(bad), `step "${step}" must not expose ${bad}`);
    }
  }
});

Deno.test("unknown step writes nothing", () => {
  const out = pickColumns("not-a-step", { business_name: "x" });
  assert(Object.keys(out).length === 0, "unknown step should yield no columns");
});

Deno.test("refund tiers are clamped and sorted descending", () => {
  const tiers = normaliseRefundTiers([
    { hours_before: 2, refund_percent: 50 },
    { hours_before: 48, refund_percent: 150 },   // over 100
    { hours_before: -5, refund_percent: -20 },   // negative
  ]);
  assert(!!tiers && tiers.length === 3, "three tiers");
  assert(tiers![0].hours_before === 48 && tiers![0].refund_percent === 100, "clamped to 100 and sorted first");
  assert(tiers![2].hours_before === 0 && tiers![2].refund_percent === 0, "negatives floored to 0");
  assert(
    tiers![0].hours_before >= tiers![1].hours_before && tiers![1].hours_before >= tiers![2].hours_before,
    "descending by hours_before",
  );
});

Deno.test("refund tiers reject non-arrays and empties", () => {
  assert(normaliseRefundTiers(null) === null, "null");
  assert(normaliseRefundTiers("100%") === null, "string");
  assert(normaliseRefundTiers([]) === null, "empty array");
});

Deno.test("private and loopback addresses are refused", () => {
  for (const addr of [
    "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255",
    "169.254.169.254", // cloud metadata
    "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "100.64.0.1",
  ]) {
    assert(isPrivateAddress(addr), `${addr} must be treated as private`);
  }
});

Deno.test("public addresses are allowed", () => {
  for (const addr of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2606:4700::1111"]) {
    assert(!isPrivateAddress(addr), `${addr} should be public`);
  }
});

Deno.test("internal hostnames are refused", () => {
  for (const host of ["localhost", "app.localhost", "db.internal", "printer.local", "127.0.0.1"]) {
    assert(isBlockedHost(host), `${host} must be blocked`);
  }
  assert(!isBlockedHost("seakayak.co.za"), "a normal domain is fine");
});

Deno.test("non-http schemes are rejected", () => {
  for (const raw of [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "gopher://example.com",
    "data:text/html,hi",
  ]) {
    let threw = false;
    try { parsePublicUrl(raw); } catch { threw = true; }
    assert(threw, `${raw} must be rejected`);
  }
});

Deno.test("cluster-internal URLs are rejected", () => {
  for (const raw of [
    "http://localhost:8000/admin",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "https://10.0.0.1/internal",
  ]) {
    let threw = false;
    try { parsePublicUrl(raw); } catch { threw = true; }
    assert(threw, `${raw} must be rejected`);
  }
});

Deno.test("a normal operator website parses", () => {
  const url = parsePublicUrl("  https://seakayak.co.za/tours  ");
  assert(url.hostname === "seakayak.co.za", "hostname parsed");
  assert(url.protocol === "https:", "protocol kept");
});

Deno.test("garbage input is rejected rather than thrown raw", () => {
  let msg = "";
  try { parsePublicUrl("not a url"); } catch (e) { msg = (e as Error).message; }
  assert(msg === "That does not look like a valid URL.", "friendly message, got: " + msg);
});
