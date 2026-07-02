import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// U9 — Scheduled campaigns must send at the scheduled time, not on the
// next cron tick. The dispatch activates due campaigns before claiming,
// but claimed items whose campaign is still "scheduled" must be released
// back to "pending" — otherwise they strand in "processing" and the
// campaign never sends when its time arrives.
describe("scheduled campaign dispatch (U9)", () => {
  const dispatch = readFileSync("supabase/functions/marketing-dispatch/index.ts", "utf8");

  it("activates scheduled campaigns only once scheduled_at is reached", () => {
    expect(dispatch).toContain('.eq("status", "scheduled")');
    expect(dispatch).toContain('.lte("scheduled_at"');
  });

  it("releases claimed items of not-yet-due campaigns back to pending", () => {
    expect(dispatch).toContain("deferredIds");
    expect(dispatch).toContain('.in("id", deferredIds).eq("status", "processing")');
  });
});
