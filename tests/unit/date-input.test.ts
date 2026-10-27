import { describe, expect, it } from "vitest";
import { parseDateInput } from "../../app/lib/date-input";

describe("typed dates", () => {
  it.each(["2026-10-21", "21/10/2026", "21.10.2026", "21 Oct 2026", "21 October 2026"])("accepts %s", value => {
    expect(parseDateInput(value)).toBe("2026-10-21");
  });
  it("uses day-first dates and accepts leap days", () => {
    expect(parseDateInput("3/4/2026")).toBe("2026-04-03");
    expect(parseDateInput("29/2/2028")).toBe("2028-02-29");
  });
  it.each(["", "21/10", "31/2/2026", "29/2/2026", "2026-13-21", "yesterday", "1/2/26"])("rejects incomplete or invalid date %s", value => {
    expect(parseDateInput(value)).toBeNull();
  });
});
