import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// M12: the help assistant, which answers from docs/admin-help, told operators
// to record cash via Edit Booking → PAID → Cash → reference (Edit has no such
// fields) and didn't know where refund percentages are set.
const doc = (name: string) => readFileSync("docs/admin-help/" + name + ".md", "utf8");

it("records cash, EFT and card-machine payments with Guest actions → Mark Paid", () => {
  const bookings = doc("bookings");
  expect(bookings).toContain("**Guest actions → Mark Paid**");
  expect(bookings).toContain("Cash, EFT (bank transfer), Card machine or Other");
  expect(bookings).not.toMatch(/Edit Booking|PAID by hand/);
});

it("says where refund percentages are set", () => {
  for (const name of ["refunds", "settings"]) expect(doc(name)).toContain("Settings → Booking Site Configuration → Cancellation Policy");
});
