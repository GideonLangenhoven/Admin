import { describe, expect, it } from "vitest";

// Mirrors booking/app/waiver/page.tsx:302-310 — the bug was that storage padded
// month/day to two digits ("05") but the <option value=...> in the selects used
// unpadded strings ("5"), so React's controlled select couldn't match and reset
// to the placeholder. The fix: strip leading zeros when parsing back into the
// select values. Storage stays padded so new Date(dob) keeps working.

function format(day: string, month: string, year: string): string {
  return (
    (year || "") +
    "-" +
    (month ? month.padStart(2, "0") : "") +
    "-" +
    (day ? day.padStart(2, "0") : "")
  );
}

function parse(dob: string): { y: string; m: string; d: string } {
  const p = dob ? dob.split("-") : ["", "", ""];
  return {
    y: p[0] || "",
    m: p[1] ? String(Number(p[1])) : "",
    d: p[2] ? String(Number(p[2])) : "",
  };
}

describe("waiver date-of-birth round-trip", () => {
  it("regression: single-digit month round-trips to unpadded select value", () => {
    // before fix: parse("1990-05-05").m was "05" → no <option value='05'> → select reset
    const stored = format("5", "5", "1990");
    expect(stored).toBe("1990-05-05");
    expect(parse(stored)).toEqual({ y: "1990", m: "5", d: "5" });
  });

  it("two-digit values pass through unchanged", () => {
    expect(parse(format("25", "12", "1990"))).toEqual({ y: "1990", m: "12", d: "25" });
  });

  it("partial: only day picked", () => {
    expect(parse(format("5", "", ""))).toEqual({ y: "", m: "", d: "5" });
  });

  it("partial: only month picked", () => {
    expect(parse(format("", "3", ""))).toEqual({ y: "", m: "3", d: "" });
  });

  it("partial: only year picked", () => {
    expect(parse(format("", "", "2020"))).toEqual({ y: "2020", m: "", d: "" });
  });

  it("empty string yields all empty parts", () => {
    expect(parse("")).toEqual({ y: "", m: "", d: "" });
  });

  it("padded storage stays parseable by Date", () => {
    // calcAge() in the page does `new Date(dob)` — needs ISO with zero-pad.
    const stored = format("5", "5", "1990");
    expect(new Date(stored).getUTCFullYear()).toBe(1990);
    expect(new Date(stored).getUTCMonth()).toBe(4); // May = index 4
    expect(new Date(stored).getUTCDate()).toBe(5);
  });

  it("all 12 months parse to unpadded select values", () => {
    for (let monthNum = 1; monthNum <= 12; monthNum++) {
      const stored = format("15", String(monthNum), "1990");
      const parsed = parse(stored);
      expect(parsed.m).toBe(String(monthNum));
    }
  });

  it("all 31 days parse to unpadded select values", () => {
    for (let dayNum = 1; dayNum <= 31; dayNum++) {
      const stored = format(String(dayNum), "5", "1990");
      const parsed = parse(stored);
      expect(parsed.d).toBe(String(dayNum));
    }
  });
});
