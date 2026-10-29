import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guestActions, type GuestActionBooking } from "../../app/lib/booking-action-registry";

// M3: one registry decides which Guest actions a booking offers, for the
// bookings list and the booking page alike.
const enabled = (b: GuestActionBooking) => guestActions(b).filter(a => !a.disabled).map(a => a.key);
const base = { phone: "0820000000", payment_url: null, allow_unpaid: false };

describe("Guest action registry", () => {
  it("a confirmed booking with money due can be paid, linked, rebooked and cancelled", () => {
    expect(enabled({ ...base, status: "CONFIRMED", total_amount: 200, total_captured: 0 })).toEqual([
      "view", "edit", "whatsapp", "whatsapp-device", "rebook", "mark-paid", "payment-link", "allow-unpaid", "resend-invoice", "cancel",
    ]);
  });

  // Round 2, item 6: create-checkout refuses a link once part is paid (a link
  // is priced for the full amount), so the action must not offer one.
  it("a part-paid booking takes its balance with Mark Paid, and says why there is no link", () => {
    const actions = guestActions({ ...base, status: "CONFIRMED", total_amount: 200, total_captured: 100 });
    const reason = "Part is already paid. Record the balance with Mark Paid.";
    expect(actions.filter(a => !a.disabled).map(a => a.key)).toEqual([
      "view", "edit", "whatsapp", "whatsapp-device", "rebook", "mark-paid", "allow-unpaid", "refund", "resend-invoice", "cancel",
    ]);
    for (const key of ["payment-link", "payment-reminder"]) {
      expect(actions.find(a => a.key === key), key).toMatchObject({ disabled: true, title: reason });
    }
    expect(actions.find(a => a.key === "payment-link")!.description).toBe(reason);
  });

  it("a paid booking offers no payment actions", () => {
    const keys = enabled({ ...base, status: "PAID", total_amount: 200, total_captured: 200, payment_url: "https://pay.invalid/x" });
    expect(keys).not.toContain("mark-paid");
    expect(keys).not.toContain("payment-link");
    expect(keys).not.toContain("payment-reminder");
    expect(keys).toEqual(expect.arrayContaining(["refund", "resend-invoice", "cancel"]));
  });

  it("a pending booking with nothing received cannot be refunded or invoiced, and says why", () => {
    const actions = guestActions({ ...base, status: "PENDING", total_amount: 300, total_captured: 0 });
    expect(actions.find(a => a.key === "refund")).toMatchObject({ disabled: true, title: "Nothing to refund: no payment received." });
    expect(actions.find(a => a.key === "resend-invoice")).toMatchObject({ disabled: true, title: "Confirm the booking before resending its invoice." });
    expect(actions.find(a => a.key === "payment-reminder")).toMatchObject({ disabled: true, title: "Send a payment link first." });
  });

  it("a cancelled booking cannot be cancelled, refunded or sent a link again", () => {
    const keys = enabled({ ...base, status: "CANCELLED", total_amount: 200, total_captured: 200 });
    for (const key of ["cancel", "refund", "payment-link"] as const) expect(keys).not.toContain(key);
  });

  it("both booking screens build their actions from the registry", () => {
    for (const file of ["app/bookings/page.tsx", "app/bookings/[id]/page.tsx"]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).toMatch(/import \{[^}]*guestActions[^}]*\} from "\.\.\/(\.\.\/)?lib\/booking-action-registry"/);
      expect(src, file).not.toContain("Record money received outside online checkout.");
    }
  });
});
