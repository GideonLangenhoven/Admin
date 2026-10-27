import { describe, expect, it } from "vitest";
import { contactPhoneNumber } from "../../app/lib/contact-links";

describe("direct customer contact numbers", () => {
  it.each([
    ["082 555 0101", "27825550101"],
    ["+27 (82) 555-0101", "27825550101"],
    ["27825550101", "27825550101"],
    ["00 44 7700 900123", "447700900123"],
    ["+1 (202) 555-0123", "12025550123"],
    [null, null], [undefined, null], ["", null], ["unknown", null],
    ["123", null], ["1234567890123456", null],
    ["Call 082 555 0101", null], ["+27 82 555 0101 ext 2", null], ["++27825550101", null],
  ])("normalizes %s for WhatsApp and calling", (input, expected) => {
    expect(contactPhoneNumber(input)).toBe(expected);
  });
});
