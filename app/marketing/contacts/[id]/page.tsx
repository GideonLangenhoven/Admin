"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useBusinessContext } from "../../../../components/BusinessContext";
import { supabase } from "../../../lib/supabase";
import { marketingReasons } from "../../../lib/marketing-journey";
import ContactPermissionEditor from "@/components/marketing/ContactPermissionEditor";

type TimelineEvent = { key: string; at: string; label: string; detail: string };
export default function MarketingContactContext() {
  const { businessId, timezone } = useBusinessContext();
  const { id } = useParams<{ id: string }>();
  const [contact, setContact] = useState<{ email: string; source: string; status: string } | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [eligibility, setEligibility] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(""); setContact(null); setEvents([]); setEligibility(null);
      const row = await supabase.from("marketing_contacts").select("id, email, source, status, created_at")
        .eq("business_id", businessId).eq("id", id).maybeSingle();
      if (cancelled) return;
      if (row.error || !row.data) { setError("Contact unavailable for this operator."); setLoading(false); return; }
      setContact(row.data);
      const [permission, evidence, communication, bookings] = await Promise.all([
        supabase.rpc("marketing_eligibility", { p_business_id: businessId, p_contact_id: id }),
        supabase.from("marketing_permission_events").select("id, decision, channel, source, evidence_at, notice_version, notice_text, evidence_ref, recorded_at")
          .eq("business_id", businessId).eq("contact_id", id).order("id", { ascending: false }).limit(100),
        supabase.from("marketing_events").select("id, event_type, created_at")
          .eq("business_id", businessId).eq("contact_id", id).order("created_at", { ascending: false }).limit(100),
        supabase.from("bookings").select("id, status, created_at").eq("business_id", businessId)
          .eq("email", row.data.email).order("created_at", { ascending: false }).limit(50),
      ]);
      if (cancelled) return;
      if ([permission,evidence,communication,bookings].some(r => r.error)) setError("History is incomplete. Some activity may be missing.");
      setEligibility(permission.error ? null : permission.data);
      const timeline: TimelineEvent[] = [{ key: "contact", at: row.data.created_at, label: "Contact stored", detail: `Source: ${row.data.source || "unknown"}. Relationship status: ${row.data.status}. This is separate from booking status.` }];
      for (const event of evidence.data || []) timeline.push({key:`permission-${event.id}`,at:event.recorded_at,label:`${event.channel} permission: ${event.decision}`,detail:`Source: ${event.source}. Notice: ${event.notice_text || event.notice_version || "unavailable"}. Evidence: ${event.evidence_ref || "unavailable"}. Evidence date: ${event.evidence_at ? new Date(event.evidence_at).toLocaleString("en-ZA",{timeZone:timezone}) : "unknown"}.`});
      for (const event of communication.data || []) timeline.push({key:`message-${event.id}`,at:event.created_at,label:`Marketing event: ${event.event_type}`,detail:"Opens and clicks do not confirm permission, reviews or bookings."});
      for (const booking of bookings.data || []) timeline.push({key:`booking-${booking.id}`,at:booking.created_at,label:`Address-matched booking: ${booking.status}`,detail:`Reference ${booking.id.slice(0,8)}. This may belong to another person using a shared address; no identity merge or relationship change is inferred.`});
      setEvents(timeline.sort((a,b) => Date.parse(b.at)-Date.parse(a.at))); setLoading(false);
    }
    if (businessId && id) void load();
    return () => { cancelled = true; };
  }, [businessId,id,timezone,revision]);
  return <section className="ui-card p-5 space-y-4" aria-labelledby="contact-history-title">
    <Link className="underline text-sm" href="/marketing/contacts">Back to contacts</Link>
    <h2 id="contact-history-title" className="text-lg font-semibold">Contact history</h2>
    {loading && <p role="status">Loading history…</p>}
    {error && <p role="alert">{error}</p>}
    {contact && <><p>{contact.email}</p><p role="status">Email marketing: {eligibility ? marketingReasons[eligibility] || eligibility : "eligibility unavailable"}.</p>
      <ContactPermissionEditor key={businessId + id} contactId={id} email={contact.email} eligibility={eligibility} onSaved={() => setRevision(value => value + 1)} />
      <p className="text-sm">Times: {timezone}. Up to 100 permission events, 100 engagement events and 50 exact-address booking matches. Attendance, enquiry and voucher events are unavailable unless a reliable source is mapped. Suppression can also come from retained address history after reimport.</p>
      <ol className="divide-y">{events.map(event => <li key={event.key} className="py-3 space-y-1"><time className="text-xs" dateTime={event.at}>{new Date(event.at).toLocaleString("en-ZA",{timeZone:timezone})}</time><h3 className="font-medium">{event.label}</h3><p className="text-sm max-w-prose" style={{color:"var(--ck-text-muted)"}}>{event.detail}</p></li>)}</ol>
    </>}
  </section>;
}
