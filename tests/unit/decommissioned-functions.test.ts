import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Security triage 2026-08-05, item 1 of 3. Six pre-multi-tenant edge functions
// were still deployed and reachable. The worst, wa-send, took a phone number
// and message and sent it via the platform-global WA_ACCESS_TOKEN with zero
// caller authorization — and verify_jwt=true is satisfied by the PUBLIC anon
// key that ships in every booking-site bundle, so anyone could send WhatsApp
// from the platform number to any recipient.
//
// All six were verified dead first (no repo reference, no cron.job invoking
// them) and their bodies replaced with a 410 tombstone. This test stops one
// from being quietly refilled with live code.
const DECOMMISSIONED = ["wa-send", "cron-jobs", "hold-expiry", "outbox-send", "payfast-itn", "send-trip-photos"];

describe("decommissioned edge functions stay decommissioned", () => {
  for (const fn of DECOMMISSIONED) {
    it(`${fn} is a 410 tombstone with no live body`, () => {
      const src = readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");
      expect(src).toContain("DECOMMISSIONED");
      expect(src).toContain("status: 410");
      // Assert against code only — the tombstone comment names the credentials
      // it used to use, which is the explanation, not a live reference.
      const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      // The whole point: no credentials, no sends, no database.
      expect(code).not.toMatch(/WA_ACCESS_TOKEN|WA_PHONE_NUMBER_ID|graph\.facebook\.com/);
      expect(code).not.toContain("SERVICE_ROLE");
      expect(code).not.toContain("createClient");
    });
  }

  it("no live function imports a decommissioned one", () => {
    const dirs = readdirSync("supabase/functions", { withFileTypes: true })
      .filter((d) => d.isDirectory() && !DECOMMISSIONED.includes(d.name));
    for (const d of dirs) {
      let src = "";
      try { src = readFileSync(`supabase/functions/${d.name}/index.ts`, "utf8"); } catch { continue; }
      for (const gone of DECOMMISSIONED) {
        expect(src, `${d.name} calls decommissioned ${gone}`).not.toContain("functions/v1/" + gone);
      }
    }
  });
});
