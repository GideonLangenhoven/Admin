"use client";
import { useCallback, useEffect, useState } from "react";
import { useBusinessContext } from "@/components/BusinessContext";
import { supabase } from "@/app/lib/supabase";

export default function ArrivalApproval({ bookingId, status, slotId, approvalVersion }: {bookingId:string;status:string;slotId:string|null;approvalVersion:number}) {
  const { businessId, role, readOnly } = useBusinessContext();
  const [reference,setReference]=useState("");
  const [reason,setReason]=useState("");
  const [history,setHistory]=useState<Array<{id:string;decision:string;account_reference:string;reason:string;created_at:string;slot_id:string;approval_version:number}>>([]);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const canApprove=["ADMIN","MAIN_ADMIN","SUPER_ADMIN"].includes(role) && !readOnly;
  const load=useCallback(async () => {
    const result=await supabase.from("booking_arrival_approvals").select("id,decision,account_reference,reason,created_at,slot_id,approval_version")
      .eq("business_id",businessId).eq("booking_id",bookingId).order("created_at",{ascending:false}).order("id",{ascending:false});
    if(result.error) setError("Approval history unavailable. Ask an admin before allowing unpaid arrival.");
    else setHistory(result.data||[]);
  },[businessId,bookingId]);
  useEffect(()=>{load();},[load]);
  async function save(decision:"approve"|"revoke") {
    if(busy||!canApprove)return;
    setBusy(true);setError("");
    try {
      const result=await supabase.rpc("approve_account_arrival",{p_business_id:businessId,p_booking_id:bookingId,p_decision:decision,p_account_reference:reference,p_reason:reason});
      if(result.error) setError(result.error.message);
      else {setReference("");setReason("");await load();}
    } catch {setError("Approval could not be confirmed. Refresh the history before retrying.");}
    finally {setBusy(false);}
  }
  const approved=history[0]?.decision==="approve"&&history[0]?.slot_id===slotId&&Number(history[0]?.approval_version)===approvalVersion;
  return <section className="mt-4 border-t border-[var(--ck-border-subtle)] pt-4" aria-labelledby="arrival-approval-heading">
    <h3 id="arrival-approval-heading" className="font-semibold">Account/reseller arrival approval</h3>
    <p className="mt-1 text-sm">Admins can approve unpaid account/reseller arrivals. No payment or message is recorded. Waiver still required; moving the booking cancels approval.</p>
    {!error&&<p className="mt-2 text-sm" role="status">{approved?"Current departure: unpaid account/reseller arrival approved. Waiver still required.":"No current unpaid-arrival approval for this departure."}</p>}
    {error&&<p role="alert" className="mt-2 text-sm text-[var(--ck-danger)]">{error}</p>}
    {canApprove && ["PAID","CONFIRMED","COMPLETED"].includes(status) && <div className="mt-3 space-y-3">
      <label className="block text-sm">Account/reseller reference<input className="ui-control mt-1 w-full" value={reference} maxLength={160} onChange={e=>setReference(e.target.value)} /></label>
      <label className="block text-sm">Reason<textarea className="ui-control mt-1 w-full" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="ui-btn ui-btn-primary" disabled={busy||!reference.trim()||!reason.trim()} onClick={()=>save("approve")}>Approve unpaid arrival</button>
      <button type="button" className="ui-btn ui-btn-soft" disabled={busy||!reference.trim()||!reason.trim()} onClick={()=>save("revoke")}>Revoke approval</button></div>
    </div>}
    <ol className="mt-3 space-y-2 text-sm" aria-label="Arrival approval history">{history.map(event=><li key={event.id}>{event.decision==="approve"?"Approved":"Revoked"} · {event.account_reference} · {event.reason}</li>)}</ol>
    {!error&&history.length===0&&<p className="mt-2 text-sm">No account/reseller approval recorded.</p>}
  </section>;
}
