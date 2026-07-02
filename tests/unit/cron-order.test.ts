import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// J6 — Cron ordering. auto-messages' auto-expire cancels past-deadline
// PENDING bookings (with no slot capacity release), which shadows
// cleanupExpiredManualBookings' proper release + admin notification.
// The cleanup functions must run BEFORE auto-messages is invoked.
describe("cron-tasks ordering (J6)", () => {
  const cronTasks = readFileSync("supabase/functions/cron-tasks/index.ts", "utf8");

  it("runs cleanupExpiredManualBookings before invoking auto-messages", () => {
    const manualIdx = cronTasks.indexOf("await cleanupExpiredManualBookings()");
    const autoMsgIdx = cronTasks.indexOf('SUPABASE_URL + "/functions/v1/auto-messages"');
    expect(manualIdx).toBeGreaterThan(-1);
    expect(autoMsgIdx).toBeGreaterThan(-1);
    expect(manualIdx).toBeLessThan(autoMsgIdx);
  });

  it("runs cleanupExpiredHolds before invoking auto-messages", () => {
    const holdsIdx = cronTasks.indexOf("await cleanupExpiredHolds()");
    const autoMsgIdx = cronTasks.indexOf('SUPABASE_URL + "/functions/v1/auto-messages"');
    expect(holdsIdx).toBeGreaterThan(-1);
    expect(holdsIdx).toBeLessThan(autoMsgIdx);
  });
});
