"use client";
import { useState } from "react";
import { getAuthHeaders } from "@/app/lib/admin-auth";
import { useBusinessContext } from "@/components/BusinessContext";

export default function ContactPermissionEditor({ contactId, email, eligibility, onSaved }: {
  contactId: string; email: string; eligibility: string | null; onSaved: () => void;
}) {
  const { businessId, role, readOnly } = useBusinessContext();
  const [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [at, setAt] = useState(""), [notice, setNotice] = useState(""), [reference, setReference] = useState("");
  const [done, setDone] = useState("");
  if (readOnly || !["MAIN_ADMIN", "SUPER_ADMIN"].includes(role) || !["eligible", "permission_unknown"].includes(eligibility || "")) return null;
  async function save(decision: "granted" | "withdrawn") {
    setSaving(true); setError(""); setDone("");
    try {
      const headers = await getAuthHeaders(businessId);
      const response = await fetch("/api/marketing/permission", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({
        contact_id: contactId, expected_email: email, decision,
        ...(decision === "granted" ? { evidence_at: new Date(at).toISOString(), notice_text: notice, evidence_ref: reference } : {}),
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Permission could not be recorded.");
      setOpen(false); setDone(decision === "granted" ? "Permission recorded." : "Contact unsubscribed."); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Permission could not be recorded."); }
    finally { setSaving(false); }
  }
  return <div className="space-y-3">
    {done && <p role="status">{done}</p>}
    {error && <p role="alert">{error}</p>}
    {!open ? <button type="button" className="ui-btn ui-btn-soft min-h-11" onClick={() => setOpen(true)}>{eligibility === "eligible" ? "Manage permission" : "Record existing permission"}</button> : <form className="space-y-3 max-w-xl" onSubmit={event => { event.preventDefault(); void save("granted"); }}>
      <p className="text-sm">Record permission already given for this operator&apos;s marketing emails. A booking or contact entry alone is not permission.</p>
      <label className="block text-sm">When permission was given<input className="ui-input mt-1 w-full" type="datetime-local" value={at} onChange={e => setAt(e.target.value)} required disabled={saving} /></label>
      <label className="block text-sm">Permission wording shown to the customer<textarea className="ui-input mt-1 w-full" value={notice} onChange={e => setNotice(e.target.value)} required minLength={10} maxLength={2000} rows={3} disabled={saving} /></label>
      <label className="block text-sm">Evidence reference<input className="ui-input mt-1 w-full" value={reference} onChange={e => setReference(e.target.value)} required minLength={3} maxLength={500} placeholder="For example, signed form reference or dated email" disabled={saving} /></label>
      <div className="flex flex-wrap gap-2">
        <button className="ui-btn ui-btn-primary min-h-11" type="submit" disabled={saving}>{saving ? "Saving…" : "Record permission"}</button>
        <button className="ui-btn ui-btn-soft min-h-11" type="button" disabled={saving} onClick={() => { setOpen(false); setError(""); }}>Cancel</button>
        <button className="ui-btn ui-btn-soft min-h-11" type="button" disabled={saving} onClick={() => void save("withdrawn")}>Unsubscribe contact</button>
      </div>
    </form>}
  </div>;
}
