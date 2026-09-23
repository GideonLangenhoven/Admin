import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("mobile-first implementation contract", () => {
  it("keeps exactly four primary admin routes plus the More trigger", () => {
    const shell = source("components/AppShell.tsx");
    const drawer = source("components/MobileMenuDrawer.tsx");
    expect(shell).toContain('const mobilePrimaryHrefs = ["/", "/bookings", "/new-booking", "/inbox"]');
    expect(shell).toContain('<MobileMenuDrawer nav={visibleNav} active={mobileMoreActive} />');
    expect(shell).not.toContain("overflow-x-auto no-scrollbar");
    expect(drawer).toContain("const drawer = open ?");
    expect(drawer).toContain('role="dialog"');
    expect(drawer).toContain('event.key === "Escape"');
    expect(drawer).toContain("triggerRef.current?.focus()");
  });

  it("orders phone dashboard operations before revenue and protects full labels", () => {
    const dashboard = source("app/page.tsx");
    expect(dashboard).toContain("order-2 grid grid-cols-1");
    expect(dashboard).toContain("order-3 block p-4");
    expect(dashboard).toContain("{slot.totalPax} guests");
    expect(dashboard).toContain("min-h-[76px]");
    expect(dashboard).toContain("h-11 w-11");
    expect(dashboard).not.toContain('max-w-[120px] truncate" style={{ color: "var(--ck-text-muted)" }} title={slot.tourName}>{slot.tourName}</div>\n                            </span>');
  });

  it("exposes the complete booking action set in the phone sheet", () => {
    const bookings = source("app/bookings/page.tsx");
    for (const label of [
      "Departure actions",
      "View booking",
      "Edit booking",
      "WhatsApp",
      "Rebook",
      "Mark Paid",
      "Payment Link",
      "Payment Reminder",
      "Allow Without Payment",
      "Require Payment",
      "Reschedule Payment Link",
      "Refund",
      "Resend Invoice",
      "Cancel",
    ]) expect(bookings, label).toContain(label);
    expect(bookings).toContain('data-mobile-action-sheet');
    expect(bookings).toContain('aria-modal="true"');
    expect(bookings).toContain("min-h-12 w-full");
  });

  it("uses one customer booking bar without hiding My Bookings navigation", () => {
    const booking = source("booking/app/book/BookingFlow.tsx");
    const combo = source("booking/app/combo/[id]/page.tsx");
    const nav = source("booking/app/components/BottomNav.tsx");
    expect(nav).toContain('pathname === "/book"');
    expect(nav).toContain('pathname.startsWith("/combo/")');
    expect(nav).not.toContain('pathname.startsWith("/book") return null');
    expect(booking).toContain('data-mobile-booking-bar="calendar"');
    expect(booking).toContain('data-mobile-booking-bar="details"');
    expect(booking).toContain('onClick={submitBooking}');
    expect(booking).toContain('{selectedSlot ? `R${grandTotal}` : "Not selected"}');
    expect(booking).toContain('{finalTotal <= 0 ? "FREE" : `R${finalTotal}`}');
    expect(combo).toContain('data-mobile-booking-bar="combo-slots"');
    expect(combo).toContain('data-mobile-booking-bar="combo-details"');
    expect(combo).toContain('onClick={submitComboBooking}');
  });

  it("keeps the customer chat within the usable viewport and handles reduced motion", () => {
    const chat = source("booking/app/components/ChatWidget.tsx");
    expect(chat).toContain('role="dialog"');
    expect(chat).toContain('aria-modal="true"');
    expect(chat).toContain("bottom-0 top-0 z-50");
    expect(chat).toContain("calc(100dvh-3rem)");
    expect(chat).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(chat).toContain("!reduceMotion && !avatarFailed");
    expect(chat).toContain("launcherRef.current?.focus()");
  });

  it("fits seven minimum-size calendar targets and applies the all-operator hero rule", () => {
    const booking = source("booking/app/book/BookingFlow.tsx");
    const home = source("booking/app/page.tsx");
    expect(booking).toContain("-mx-4 py-4");
    expect(booking).toContain("aspect-square min-h-11 min-w-11");
    expect(booking).toContain('grid grid-cols-7 gap-0');
    expect(home).toContain("{theme.hero_title?.trim() && (");
  });
});
