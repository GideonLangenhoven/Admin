import { expect, it } from "vitest";
import { sourceHandler } from "../helpers/source-handler";

for (const business of [
  { booking_site_url: "https://operator.example.invalid/", expected: "https://operator.example.invalid" },
  { subdomain: "operator", expected: "https://operator.booking.bookingtours.co.za" },
  { expected: "https://booking.bookingtours.co.za" },
]) {
  it(`R19 waiver redirects to ${business.expected} and retains the capability`, async () => {
    const db = { from: (table: string) => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "bookings" ? { business_id: "fixture-business" } : business }) };
      return q;
    } };
    const handler = sourceHandler("supabase/functions/waiver-form/index.ts", { "https://esm.sh/@supabase/supabase-js@2": { createClient: () => db } });
    const response = await handler(new Request("https://test.invalid?booking=fixture&token=secret"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(business.expected + "/waiver?booking=fixture&token=secret");
  });
}
