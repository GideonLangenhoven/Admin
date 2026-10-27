import { describe,expect,it } from "vitest";
import { arrivalReadiness,groupDepartureBookings,nextManifestDepartures,operatorDashboardRange } from "../../app/lib/operator-day";
import { bookingResolutionUrl } from "../../app/lib/simple-view";

describe("operator daily facts",()=>{
 it("uses operator midnight when the browser day differs",()=>{
  expect(operatorDashboardRange("Africa/Johannesburg",new Date("2026-10-15T22:30Z"))).toMatchObject({p_today_start:"2026-10-15T22:00:00.000Z",p_tomorrow_start:"2026-10-16T22:00:00.000Z",p_day_after:"2026-10-17T22:00:00.000Z"});
 });
 it.each([["2026-03-08T12:00Z",23],["2026-11-01T12:00Z",25]])("keeps DST day %s at %s hours",(instant,hours)=>{
  const bounds=operatorDashboardRange("America/New_York",new Date(instant));expect((Date.parse(bounds.p_tomorrow_start)-Date.parse(bounds.p_today_start))/3600000).toBe(hours);
 });
 it("keeps simultaneous departures separate and moved records on their exact slot",()=>{
  const rows=[{id:"moved",slot_id:"friday",slots:{start_time:"2026-10-16T08:00Z"}},{id:"a",slot_id:"thursday-kayak",slots:{start_time:"2026-10-15T08:00Z"}},{id:"b",slot_id:"thursday-hike",slots:{start_time:"2026-10-15T08:00Z"}}];
  const groups=groupDepartureBookings(rows);expect(groups).toHaveLength(3);expect(groups[2][0].id).toBe("moved");
 });
 it("confirmed is not paid and a generic allow-unpaid flag is not account approval",()=>{
  expect(arrivalReadiness({qty:2,arrived_count:0,status:"CONFIRMED",total_amount:200,total_captured:100,waiver_status:"SIGNED",allow_unpaid:true})).toMatchObject({due:100,paymentReady:false,canIncrease:false});
 });
 it("matches each arrival blocker to the action and booking section that resolves it",()=>{
  const booking={qty:2,arrived_count:0,status:"CONFIRMED",total_amount:200,total_captured:100,waiver_status:"PENDING"};
  expect(arrivalReadiness(booking)).toMatchObject({resolutionSection:"payment",resolutionLabel:"Review payment",canIncrease:false});
  expect(arrivalReadiness({...booking,status:"PENDING"})).toMatchObject({resolutionSection:"summary",resolutionLabel:"Review booking status",reason:"Confirm booking",canIncrease:false});
  expect(arrivalReadiness({...booking,total_captured:200})).toMatchObject({resolutionSection:"waiver",resolutionLabel:"Resolve waiver",reason:"Resolve waiver",canIncrease:false});
  expect(arrivalReadiness({...booking,unpaid_arrival_approved:true})).toMatchObject({resolutionSection:"waiver",resolutionLabel:"Resolve waiver",reason:"Resolve waiver",canIncrease:false});
  expect(arrivalReadiness({...booking,total_captured:200,waiver_status:"SIGNED"})).toMatchObject({resolutionSection:"summary",resolutionLabel:"Review booking",canIncrease:true});
 });
 it("allows an explicitly approved account but never bypasses the waiver or cancelled state",()=>{
  const booking={qty:2,arrived_count:0,status:"CONFIRMED",total_amount:200,total_captured:0,unpaid_arrival_approved:true,waiver_status:"SIGNED"};
  expect(arrivalReadiness(booking).canIncrease).toBe(true);expect(arrivalReadiness({...booking,waiver_status:"PENDING"}).canIncrease).toBe(false);expect(arrivalReadiness({...booking,status:"CANCELLED"}).canIncrease).toBe(false);
 });
 it("preserves the existing legacy paid interpretation without inventing a confirmed capture",()=>{
  expect(arrivalReadiness({qty:1,arrived_count:0,status:"PAID",total_amount:100,total_captured:0,waiver_status:"SIGNED"}).canIncrease).toBe(true);
  expect(arrivalReadiness({qty:1,arrived_count:0,status:"CONFIRMED",total_amount:100,total_captured:0,waiver_status:"SIGNED"}).canIncrease).toBe(false);
 });
 it.each([
  [0,"SIGNED",false], [100,"SIGNED",false], [200,"PENDING",false], [200,"SIGNED",true],
 ])("requires payment in full for Simple View even with account approval (%s captured, %s waiver)",(captured,waiver,expected)=>{
  const booking={qty:2,arrived_count:0,status:"CONFIRMED",total_amount:200,total_captured:captured,unpaid_arrival_approved:true,waiver_status:waiver};
  expect(arrivalReadiness(booking,{requirePaid:true}).canIncrease).toBe(expected);
  if(captured<200)expect(arrivalReadiness(booking,{requirePaid:true})).toMatchObject({paymentReady:false,resolutionSection:"payment",reason:"Payment must be received in full before recording arrivals."});
 });
 it("links exact booking and safe return filters without accepting an external return URL",()=>{
  const href=bookingResolutionUrl("abc","/simple/check-ins?date=2026-10-15&slot=10000000-0000-4000-8000-000000000004","waiver");
  expect(href).toContain("/bookings/abc?returnTo=");expect(href.endsWith("#waiver")).toBe(true);expect(decodeURIComponent(href)).toContain("date=2026-10-15");expect(bookingResolutionUrl("abc","//evil.invalid")).not.toContain("evil");
 });
});

describe("next departure in the dashboard manifest", () => {
 const early={id:"early",timeRaw:"2026-10-21T07:00:00+02:00"};
 const later={id:"later",timeRaw:"2026-10-21T10:30:00+02:00"};

 it("shows the 07:00 departure at 07:00 and hides the 10:30 slot", () => {
  expect(nextManifestDepartures([early,later],Date.parse("2026-10-21T07:00:00+02:00"))).toEqual([early]);
 });

 it("chooses the closest upcoming time even when input is unsorted", () => {
  const next={id:"next",timeRaw:"2026-10-21T07:30:00+02:00"};
  expect(nextManifestDepartures([later,next],Date.parse("2026-10-21T07:00:00+02:00"))).toEqual([next]);
 });

 it("advances automatically after the current departure's four-minute grace period", () => {
  expect(nextManifestDepartures([early,later],Date.parse("2026-10-21T07:04:00+02:00"))).toEqual([early]);
  expect(nextManifestDepartures([early,later],Date.parse("2026-10-21T07:04:00.001+02:00"))).toEqual([later]);
 });

 it("keeps activities leaving at the same instant separate", () => {
  const simultaneous={id:"other-activity",timeRaw:"2026-10-21T05:00:00Z"};
  expect(nextManifestDepartures([early,later,simultaneous],Date.parse("2026-10-21T04:00:00Z"))).toEqual([early,simultaneous]);
 });

 it("does not fall back to a past or undated departure", () => {
  expect(nextManifestDepartures([early,{id:"invalid",timeRaw:"unknown"}],Date.parse("2026-10-21T08:00:00+02:00"))).toEqual([]);
  expect(nextManifestDepartures([],Date.now())).toEqual([]);
 });

 it("shows only the first booked time when viewing tomorrow", () => {
  const tomorrow={id:"tomorrow",timeRaw:"2026-10-22T07:00:00+02:00"};
  const afternoon={id:"afternoon",timeRaw:"2026-10-22T14:00:00+02:00"};
  const slots=[afternoon,tomorrow];
  expect(nextManifestDepartures(slots,Date.parse("2026-10-21T12:00:00+02:00"))).toEqual([tomorrow]);
  expect(slots).toEqual([afternoon,tomorrow]);
 });
});
