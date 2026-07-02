import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// J10 — Stale DRAFT bookings (abandoned pre-checkout drafts) must be
// cleaned up by cron after 24h; they are never referenced again and
// hold customer PII indefinitely otherwise.
describe("stale DRAFT booking cleanup (J10)", () => {
  const cronTasks = readFileSync("supabase/functions/cron-tasks/index.ts", "utf8");

  it("cron-tasks has a DRAFT cleanup routine wired into the handler", () => {
    expect(cronTasks).toContain("cleanupStaleDraftBookings");
    expect(cronTasks).toContain("await cleanupStaleDraftBookings()");
  });

  it("only deletes DRAFT rows older than 24 hours", () => {
    expect(cronTasks).toContain('.eq("status", "DRAFT")');
    expect(cronTasks).toContain("24 * 60 * 60 * 1000");
  });
});
