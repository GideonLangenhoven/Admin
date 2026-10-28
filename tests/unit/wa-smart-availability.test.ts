import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// "Anything tomorrow morning?" on WhatsApp: the real parser and handler, with
// "now" pinned and the tenant on Africa/Johannesburg (UTC+2).
const wa = "supabase/functions/wa-webhook/index.ts";
const src = readFileSync(wa, "utf8");
const constant = (name: string) => Function("return " + src.match(new RegExp("const " + name + "[^=]*=\\s*(\\{[\\s\\S]*?\\});"))![1])();
const tenant = { business: { id: "tenant-a", timezone: "Africa/Johannesburg" } };

function load(now: string) {
  vi.useFakeTimers({ now: new Date(now), toFake: ["Date"] });
  const fn = (name: string, bindings: Record<string, unknown> = {}) => sourceFunction(wa, name, { Date, ...bindings });
  const tenantTimeZone = fn("tenantTimeZone");
  const getTimeZoneOffsetMs = fn("getTimeZoneOffsetMs");
  const tenantTodayKey = fn("tenantTodayKey", { tenantTimeZone });
  const addDaysToKey = fn("addDaysToKey");
  const keyFromParts = fn("keyFromParts");
  const helpers = {
    tenantTodayKey, addDaysToKey, keyFromParts, formatDateOnly: fn("formatDateOnly", { tenantTimeZone }),
    zonedDateTimeToUtcIso: fn("zonedDateTimeToUtcIso", { getTimeZoneOffsetMs, tenantTimeZone }),
    parseLocalDate: fn("parseLocalDate", { tenantTodayKey, addDaysToKey, keyFromParts, WEEKDAY_INDEX: constant("WEEKDAY_INDEX"), MONTH_INDEX: constant("MONTH_INDEX") }),
  };
  const parseTimeRef = fn("parseTimeRef", helpers);
  return { parseTimeRef, fn };
}
const range = (ref: any) => ref && [ref.start.toISOString(), ref.end.toISOString(), ref.label];

afterEach(() => { vi.useRealTimers(); });

describe("WhatsApp availability questions", () => {
  // Wednesday 28 Oct 2026, 12:00 in Johannesburg.
  const wed = "2026-10-28T10:00:00Z";

  it("uses the tenant's wall clock, not the server's", () => {
    const { parseTimeRef } = load(wed);
    expect(range(parseTimeRef(tenant, "any space tomorrow morning?"))).toEqual(["2026-10-29T03:00:00.000Z", "2026-10-29T10:00:00.000Z", "tomorrow morning"]);
    expect(range(parseTimeRef(tenant, "is the sunset paddle on tomorrow"))).toEqual(["2026-10-29T14:00:00.000Z", "2026-10-29T19:00:00.000Z", "tomorrow evening"]);
    expect(range(parseTimeRef(tenant, "friday at 9am"))).toEqual(["2026-10-30T07:00:00.000Z", "2026-10-30T09:00:00.000Z", "Fri, 30 Oct"]);
  });

  it("does not read weekdays out of other words", () => {
    const { parseTimeRef } = load(wed);
    expect(parseTimeRef(tenant, "any sunset trips available")).toBeNull();
    expect(parseTimeRef(tenant, "what's available this month")).toBeNull();
    expect(parseTimeRef(tenant, "any space for my friends")).toBeNull();
  });

  it("this weekend on a Saturday is the weekend under way", () => {
    const { parseTimeRef } = load("2026-10-31T08:00:00Z");
    expect(range(parseTimeRef(tenant, "anything this weekend?"))).toEqual(["2026-10-30T22:00:00.000Z", "2026-11-01T22:00:00.000Z", "this weekend"]);
  });

  it("a bare ordinal day rolls to next month once it has passed", () => {
    const { parseTimeRef } = load(wed);
    expect(range(parseTimeRef(tenant, "space on the 21st?"))?.[0]).toBe("2026-11-20T22:00:00.000Z");
  });

  it("lists only departures still open for booking, at their real price", async () => {
    const { parseTimeRef, fn } = load(wed);
    const filters: any[] = []; const sent: string[] = [];
    const chain: any = { then: (resolve: any) => resolve({ data: [
      { start_time: "2026-10-28T14:00:00Z", capacity_total: 10, booked: 9, held: 0, price_per_person_override: 450, tours: { name: "Sunset Paddle", base_price_per_person: 600 } },
      { start_time: "2026-10-28T15:00:00Z", capacity_total: 10, booked: 2, held: 0, price_per_person_override: null, tours: { name: "Night Paddle", base_price_per_person: null } },
    ] }) };
    for (const name of ["select", "eq", "gte", "lt", "order"]) chain[name] = (...args: any[]) => { filters.push([name, ...args]); return chain; };
    const handleSmartAvail = fn("handleSmartAvail", {
      parseTimeRef, supabase: { from: () => chain }, fmtTime: (_t: any, iso: string) => iso,
      sendText: async (_t: any, _p: any, m: string) => { sent.push(m); }, sendButtons: async (_t: any, _p: any, m: string) => { sent.push(m); },
    });
    expect(await handleSmartAvail(tenant, "27825550100", "anything today?")).toBe(true);
    // From now + 60 minutes, not from midnight.
    expect(filters).toContainEqual(["gte", "start_time", "2026-10-28T11:00:00.000Z"]);
    expect(sent[0]).toContain("1 spot, R450/pp");
    expect(sent[0]).toContain("8 spots\n");
    expect(sent[0]).not.toContain("R600");
  });
});
