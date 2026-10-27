import { describe, expect, it } from "vitest";
import { groupBookingPeriods } from "../../app/lib/report-booking-periods";

describe("booking report periods", () => {
  const bookings = [
    {created_at:"2026-10-21T22:30:00Z",qty:2,slots:{start_time:"2026-11-01T08:00:00Z"}},
    {created_at:"2026-10-22T06:00:00Z",qty:3,slots:{start_time:"2026-11-02T08:00:00Z"}},
    {created_at:"2026-10-20T08:00:00Z",qty:1,slots:null},
  ];

  it("groups by the business's local booking day, in date order",()=>{
    expect(groupBookingPeriods(bookings,"day","created","Africa/Johannesburg")).toMatchObject([
      {key:"2026-10-20",bookings:1,guests:1},
      {key:"2026-10-22",bookings:2,guests:5},
    ]);
  });

  it("uses the chosen tour date and keeps missing departures separate",()=>{
    expect(groupBookingPeriods(bookings,"day","slot","Africa/Johannesburg")).toMatchObject([
      {key:"2026-11-01",bookings:1,guests:2},
      {key:"2026-11-02",bookings:1,guests:3},
      {key:"undated",label:"Date unavailable",bookings:1,guests:1},
    ]);
  });

  it("uses Monday weeks across month and year boundaries",()=>{
    const rows=["2025-12-31","2026-01-04","2026-01-05"].map(day=>({created_at:day+"T12:00:00Z",qty:2}));
    expect(groupBookingPeriods(rows,"week","created","UTC")).toMatchObject([
      {key:"2025-12-29",label:"Week of 29 Dec 2025",bookings:2,guests:4},
      {key:"2026-01-05",bookings:1,guests:2},
    ]);
  });

  it("keeps different years' months distinct and preserves all guests",()=>{
    const rows=["2025-10-01","2026-10-01","2026-10-31"].map(day=>({created_at:day+"T12:00:00Z",qty:2}));
    const result=groupBookingPeriods(rows,"month","created","UTC");
    expect(result).toMatchObject([
      {key:"2025-10-01",label:"October 2025",bookings:1,guests:2},
      {key:"2026-10-01",label:"October 2026",bookings:2,guests:4},
    ]);
    expect(result.reduce((sum,row)=>sum+row.bookings,0)).toBe(rows.length);
  });

  it("handles local dates across daylight saving without splitting the day",()=>{
    const rows=[{created_at:"2026-11-01T08:30:00Z",qty:2},{created_at:"2026-11-01T09:30:00Z",qty:1}];
    expect(groupBookingPeriods(rows,"day","created","America/Los_Angeles")).toMatchObject([{key:"2026-11-01",bookings:2,guests:3}]);
  });

  it("keeps invalid dates visible and supports an empty report",()=>{
    expect(groupBookingPeriods([{created_at:"invalid",qty:1}],"month","created","UTC")).toMatchObject([{key:"undated",bookings:1,guests:1}]);
    expect(groupBookingPeriods([],"day","created","UTC")).toEqual([]);
  });
});
