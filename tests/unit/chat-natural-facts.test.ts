import { describe, expect, it } from "vitest";
import { formatTourMeetingPoints } from "../../supabase/functions/_shared/bot-guards";
import { sourceFunction } from "../helpers/source-handler";

const availabilityReplyForDate = sourceFunction("supabase/functions/web-chat/index.ts", "availabilityReplyForDate", {
  dateKey: (iso: string) => iso.slice(0, 10),
  fmtDate: (iso: string) => iso.slice(0, 10),
  fmtTime: (iso: string) => iso.slice(11, 16),
});

const tryFaqOrToursReply = sourceFunction("supabase/functions/web-chat/index.ts", "tryFaqOrToursReply", {
  formatTourMeetingPoints,
});

describe("natural customer fact replies", () => {
  it("answers a date-specific availability question and offers the next opening", () => {
    const reply = availabilityReplyForDate([
      { start_time: "2026-09-21T05:00:00Z", tour_name: "Sunrise Hike", available_capacity: 8 },
    ], "2026-09-16", "tomorrow");
    expect(reply).toContain("There aren't any open trips tomorrow");
    expect(reply).toContain("Sunrise Hike on 2026-09-21 at 05:00 (8 spots)");
  });

  it("lists matching departures when the requested date is available", () => {
    const reply = availabilityReplyForDate([
      { start_time: "2026-09-16T07:00:00Z", tour_name: "Operator One Tour", available_capacity: 3 },
      { start_time: "2026-09-17T07:00:00Z", tour_name: "Later Tour", available_capacity: 4 },
    ], "2026-09-16", "tomorrow");
    expect(reply).toContain("Operator One Tour at 07:00 (3 spots)");
    expect(reply).not.toContain("Later Tour");
  });

  it("preserves an operator's configured business meeting point", () => {
    expect(tryFaqOrToursReply("where do we meet?", {}, "", {
      meeting_point_address: "Operator address",
      arrival_instructions: "Arrive early",
    }, [{ name: "Tour", meeting_point: "Tour-specific point" }]))
      .toBe("📍 Operator address\nArrive early");
  });

  it("falls back to per-tour meeting points when business-level fields are empty", () => {
    const reply = tryFaqOrToursReply("where do i meet you?", {}, "", {}, [
      { name: "Operator A Sunrise", meeting_point: "A trailhead" },
      { name: "Operator B Sunset", meeting_point: "B car park" },
    ]);
    expect(reply).toContain("Operator A Sunrise: A trailhead");
    expect(reply).toContain("Operator B Sunset: B car park");
  });
});
