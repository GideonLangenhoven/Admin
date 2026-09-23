import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

const isYocoCheckoutUrl = sourceFunction("booking/app/lib/checkout-session.ts", "isYocoCheckoutUrl", {});
const bookingCheckoutBody = sourceFunction("booking/app/lib/booking-checkout.ts", "bookingCheckoutBody", {});
const parseBookingCheckout = sourceFunction("booking/app/lib/booking-checkout.ts", "parseBookingCheckout", { isYocoCheckoutUrl });
const saveCheckout = sourceFunction("booking/app/lib/checkout-session.ts", "saveCheckout", { isYocoCheckoutUrl });

function fixture({ free = false, soldOut = false, retry = false, email = "guest@example.invalid" } = {}) {
  const booking = { id: "booking-a", business_id: "operator-a", waiver_token: "fixture-proof", waiver_status: "PENDING", status: retry ? "HELD" : "PENDING", qty: 1, slot_id: "slot-a" };
  const writes: any[] = [];
  const showToast = vi.fn(), setStep = vi.fn(), navigate = vi.fn(), setDraftBookingId = vi.fn();
  const checkoutUrl = free ? "https://booking.example.invalid/success" : "https://c.yoco.com/pay/fixture";
  const checkout = vi.fn(async () => ({ data: soldOut ? { reason: "No spots available" } : {
    redirectUrl: checkoutUrl, amount: free ? 0 : 100, fully_covered: free,
    expires_at: new Date(Date.now()+900000).toISOString(),
  } }));
  function client(scoped: boolean) {
    return { from(table: string) {
      const q: any = { insert: (value: any) => { writes.push({table,value,scoped}); return q; },
        select: () => q, eq: () => q, update: (value: any) => { writes.push({table,value,scoped}); return q; },
        single: async () => ({ data: booking, error: null }) };
      return q;
    } };
  }
  const createBookingSupabase = vi.fn((business: string, id: string, token: string) => {
    expect([business,id,token]).toEqual([booking.business_id,booking.id,booking.waiver_token]); return client(true);
  });
  const submit = sourceFunction("booking/app/book/BookingFlow.tsx", "submitBooking", {
    crypto: { randomUUID: vi.fn().mockReturnValueOnce(booking.id).mockReturnValueOnce(booking.waiver_token) },
    name: " Fixture Guest ", email, phone: "820000000", dialCode: "+27", termsAccepted: true, submitting: false,
    normalizePhone: () => "27820000000", appliedPromo: {code:"SAVE",discount_type:"PERCENT",discount_value:20}, computedPromoDiscount:20,
    selectedTour: { id: "tour-a", business_id: "operator-a" }, selectedSlot: { id: "slot-a" }, theme:{id:"operator-a"},
    qty:1, effectiveUnitPrice:100, finalTotal:free?0:100, grandTotal:100, effectiveVoucherCredit:free?100:0,
    embed:false, marketingOptIn:false, isCompany:false, draftBookingId:retry?booking.id:null, draftWaiverToken:retry?booking.waiver_token:null,
    tenantSupabase:client(false), createBookingSupabase, selectedAddOns:{"extra-a":2}, vouchers:[{id:"voucher-a",code:"FIXTURE1"}],
    supabase:{functions:{invoke:checkout}}, showToast,setStep,setDraftBookingId,
    bookingCheckoutBody, parseBookingCheckout, saveCheckout,
    setSubmitting:vi.fn(),setDraftWaiverToken:vi.fn(),setBookingRef:vi.fn(),clearLocalDraft:vi.fn(),setPaymentUrl:vi.fn(),setCheckoutAmount:vi.fn(),setHoldExpiresAt:vi.fn(),
    window:{location:{assign:navigate}},sessionStorage:{setItem:vi.fn()},document:{getElementById:()=>({focus:vi.fn()})},
  });
  return {submit,writes,checkout,showToast,setStep,navigate,setDraftBookingId,checkoutUrl};
}

describe("storefront authoritative checkout", () => {
  for(const free of [false,true]) it(`sends proof, promo, vouchers and extras for ${free?'free':'cash'} checkout`,async()=>{
    const f=fixture({free});await f.submit();
    expect(f.checkout).toHaveBeenCalledOnce();
    expect(f.checkout.mock.calls[0]).toMatchObject(["create-checkout",{body:{booking_id:"booking-a",booking_token:"fixture-proof",promo_code:"SAVE",voucher_ids:["voucher-a"],add_ons:[{id:"extra-a",qty:2}]}}]);
    expect(f.navigate).toHaveBeenCalledWith(f.checkoutUrl);
    expect(f.setDraftBookingId).toHaveBeenCalledWith("booking-a");
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toMatchObject({scoped:true,value:{id:"booking-a",waiver_token:"fixture-proof"}});
  });
  it("shows a server capacity failure without opening payment",async()=>{
    const f=fixture({soldOut:true});await f.submit();expect(f.navigate).not.toHaveBeenCalled();expect(f.showToast).toHaveBeenCalledWith("No spots available","error");
  });
  it("retries an existing held booking without inserting another or changing its price",async()=>{
    const f=fixture({retry:true});await f.submit();expect(f.writes).toEqual([]);expect(f.checkout).toHaveBeenCalledOnce();
  });
  it("reports an invalid email before saving or paying",async()=>{
    const f=fixture({email:"invalid"});await f.submit();expect(f.writes).toEqual([]);expect(f.checkout).not.toHaveBeenCalled();expect(f.showToast).toHaveBeenCalledWith("Please enter a valid email address.","error");
  });
});
