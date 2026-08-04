import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The dispatcher used to move 50 emails per run on a 5-minute cron: 14,400 a
// day for the entire platform, which at 2,000 tenants is about 7 emails per
// tenant per day. These assertions pin the properties that lifted that ceiling,
// because every one of them is the kind of thing a later "tidy-up" silently
// reverts.
describe("marketing dispatch throughput", () => {
  const src = readFileSync("supabase/functions/marketing-dispatch/index.ts", "utf8");

  const batchSize = Number(/const BATCH_SIZE = (\d+)/.exec(src)![1]);
  const resendMax = Number(/const RESEND_BATCH_MAX = (\d+)/.exec(src)![1]);

  it("claims the maximum the claim RPC will hand out", () => {
    // claim_marketing_queue caps at 500 (least(p_limit, 500)); asking for more
    // would be silently truncated and give a false sense of headroom.
    expect(batchSize).toBe(500);
  });

  it("respects Resend's 100-per-request batch limit", () => {
    expect(resendMax).toBe(100);
    expect(batchSize).toBeGreaterThan(resendMax); // otherwise chunking is dead code
  });

  it("sends chunks in parallel rather than one request per email", () => {
    expect(src).toContain("chunk(emailPayloads, RESEND_BATCH_MAX)");
    expect(src).toContain("await Promise.all(groups.map(");
  });

  it("writes unsubscribe tokens in one insert, not one per email", () => {
    expect(src).toContain("insert(tokenRows)");
    // The per-email insert inside the build loop is what capped batch size.
    expect(src).not.toMatch(/from\("marketing_unsubscribe_tokens"\)\.insert\(\{/);
  });

  it("still writes every unsubscribe token BEFORE anything is sent", () => {
    // The ordering is the safety property: no recipient may receive an email
    // whose unsubscribe link has no row behind it.
    expect(src.indexOf("insert(tokenRows)")).toBeLessThan(src.indexOf("api.resend.com/emails/batch"));
  });

  it("records send ids in bounded concurrent waves, not sequentially", () => {
    expect(src).toContain("chunk(idUpdates, DB_WRITE_CONCURRENCY)");
    expect(src).not.toMatch(/await supabase\.from\("marketing_queue"\)\.update\(\{ resend_email_id/);
  });

  it("scopes a failed request to its own chunk", () => {
    // Previously one bad response failed every payload in the run. With five
    // chunks in flight that would condemn 400 innocent recipients.
    const failBlock = src.slice(src.indexOf("// This chunk failed"));
    expect(failBlock).toContain("for (const p of group)");
  });

  it("survives a network error on one chunk", () => {
    expect(src).toContain(".catch((e) => ({ ok: false, status: 0");
    expect(src).toContain("res.status === 0");
  });
});
