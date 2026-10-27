import { describe, expect, it } from "vitest";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { contactPhoneNumber } from "../../app/lib/contact-links";
import { isEmail } from "../../app/lib/sanitize";
import { sourceExports } from "../helpers/source-handler";

type Contact = (props: { booking: { id: string; status: string; waiver_status: string; customer_name: string; phone: string | null; email: string | null }; requestWaiver?: boolean }) => ReactElement | null;
const booking = { id: "booking-a", status: "CONFIRMED", waiver_status: "PENDING", customer_name: "Guest Example", phone: "+44 7700 900123", email: "guest@example.invalid" };

describe.each([
  ["Dashboard", "components/DashboardContact.tsx", "../app/lib", "Phone"],
  ["Simple View", "components/simple/BookingContact.tsx", "@/app/lib", "Call"],
])("%s contact icons", (_name, file, lib, phoneLabel) => {
  const waiverEmail = { default: () => jsx.jsx("button", { "aria-label": "Email waiver to Guest Example" }) };
  const { default: ContactIcons } = sourceExports(file, {
    "react/jsx-runtime": jsx,
    "@phosphor-icons/react": { WhatsappLogo: "svg", Phone: "svg", EnvelopeSimple: "svg" },
    [lib + "/contact-links"]: { contactPhoneNumber },
    [lib + "/sanitize"]: { isEmail },
    "./booking/BookingWaiverEmail": waiverEmail,
    "@/components/booking/BookingWaiverEmail": waiverEmail,
  }) as { default: Contact };

  it("keeps working contact links and accessible labels without visible words", () => {
    const html = renderToStaticMarkup(ContactIcons({ booking }));
    expect(html).toContain('href="https://wa.me/447700900123"');
    expect(html).toContain('href="tel:+447700900123"');
    expect(html).toContain('href="mailto:guest@example.invalid"');
    for (const label of ["WhatsApp", phoneLabel, "Email"]) {
      expect(html).toContain(`aria-label="${label} Guest Example"`);
    }
    expect(html.replace(/<[^>]*>/g, "")).toBe("");
  });

  it("omits missing or invalid contacts", () => {
    expect(ContactIcons({ booking: { ...booking, phone: "invalid", email: "invalid" } })).toBeNull();
    const html = renderToStaticMarkup(ContactIcons({ booking: { ...booking, phone: null } }));
    expect(html).toContain('href="mailto:guest@example.invalid"');
    expect(html).not.toContain('href="tel:');
    expect(html).not.toContain("wa.me");
  });

  it("uses the waiver action for unsigned Roll Call bookings", () => {
    const html = renderToStaticMarkup(ContactIcons({ booking, requestWaiver: true }));
    expect(html).toContain('aria-label="Email waiver to Guest Example"');
    expect(html).not.toContain("mailto:");
  });

  it("keeps ordinary email for signed waivers", () => {
    const html = renderToStaticMarkup(ContactIcons({ booking: { ...booking, waiver_status: "SIGNED" }, requestWaiver: true }));
    expect(html).toContain("mailto:guest@example.invalid");
    expect(html).not.toContain("Email waiver");
  });
});
