import { expect, it } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// WhatsApp identifies a guest as "27…"; the booking site stores "+27…".
it("a guest who booked on the website is recognised on WhatsApp, in their own tenant only", async () => {
  const bookings = [
    { id: "web", business_id: "tenant-a", phone: "+27825550100", status: "PAID" },
    { id: "other-tenant", business_id: "tenant-b", phone: "27825550199", status: "PAID" },
  ];
  const from = () => {
    const filters: ((row: any) => boolean)[] = [];
    const q: any = {
      select: () => q, limit: () => q,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; },
      then: (resolve: any) => resolve({ data: bookings.filter(row => filters.every(filter => filter(row))) }),
    };
    return q;
  };
  const hasActiveBookings = sourceFunction("supabase/functions/wa-webhook/index.ts", "hasActiveBookings", { supabase: { from } });
  expect(await hasActiveBookings({ business: { id: "tenant-a" } }, "27825550100")).toBe(true);
  expect(await hasActiveBookings({ business: { id: "tenant-a" } }, "27825550199")).toBe(false);
});
