import { describe, expect, it } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

describe("booking confirmation queue", () => {
  it("keeps one job and the original due time when confirmation is requested again", async () => {
    const jobs = new Map<string, any>();
    let now = Date.parse("2026-10-18T10:00:00Z");
    const supabase = {
      from(table: string) {
        const query: any = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: { id: "booking-a", business_id: "a", status: "PAID", email: "guest@fixture.invalid" } }),
          upsert: async (job: any, options: any) => {
            expect(table).toBe("notification_jobs");
            expect(options).toEqual({ onConflict: "dedupe_key", ignoreDuplicates: true });
            if (!jobs.has(job.dedupe_key)) jobs.set(job.dedupe_key, job);
            return { error: null };
          },
        };
        return query;
      },
    };
    const queue = sourceFunction("supabase/functions/send-email/index.ts", "queueBookingConfirmation", {
      supabase, isValidEmail: () => true,
      Date: class extends Date { static now() { return now; } },
    });
    const data = { booking_id: "booking-a", business_id: "a" };
    await queue(data);
    now += 60_000;
    await queue(data);
    expect([...jobs.values()]).toMatchObject([{
      dedupe_key: "booking-confirmation/booking-a",
      next_attempt_at: "2026-10-18T10:05:00.000Z",
      recipient: "guest@fixture.invalid",
      template_type: "BOOKING_CONFIRM",
    }]);
  });

  it("reports a queue write failure instead of claiming the confirmation was queued", async () => {
    const query: any = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: { id: "booking-a", business_id: "a", status: "PAID", email: "guest@fixture.invalid" } }),
      upsert: async () => ({ error: { message: "Database unavailable" } }),
    };
    const queue = sourceFunction("supabase/functions/send-email/index.ts", "queueBookingConfirmation", {
      supabase: { from: () => query }, isValidEmail: () => true,
    });
    await expect(queue({ booking_id: "booking-a", business_id: "a" })).rejects.toThrow("Database unavailable");
  });
});
