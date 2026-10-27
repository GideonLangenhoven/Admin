"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/app/lib/supabase";
import {
  clearGuideQueueAuthContext,
  createGuideQueueItem,
  currentGuideQueueAuthority,
  currentGuideQueueAuthGeneration,
  GUIDE_QUEUE_UPDATE_EVENT,
  guideQueueAuthContext,
  guideQueueRetryAt,
  isCurrentGuideQueueAuthClear,
  isCurrentGuideQueueAuthContext,
  postGuideQueueAuthContext,
  queueGuideCheckIn,
  rejectGuideQueueCredential,
  registerGuideCheckInSync,
  requestGuideQueueStatus,
  type GuideCheckInPayload,
  type GuideQueueUpdate,
} from "@/app/lib/guide-offline";
import { arrivalReadiness, type ArrivalBooking } from "@/app/lib/operator-day";
import { bookingResolutionUrl } from "@/app/lib/simple-view";
import { useBusinessContext } from "@/components/BusinessContext";
import { notify } from "@/app/lib/app-notify";
import { Check } from "@phosphor-icons/react";
import { bookingCustomFieldEntries } from "../../../../supabase/functions/_shared/booking-custom-fields";

type Booking = ArrivalBooking & {
  id: string;
  customer_name: string;
  phone: string;
  qty: number;
  arrived_count: number;
  checked_in: boolean;
  checked_in_at: string | null;
  waiver_status: string | null;
  question_answers: Array<{ key: string; label: string; value: string }>;
  add_ons: Array<{ name: string; qty: number }>;
};

function canonicalArrival(data: any, booking: Booking, expectedSlotId?: string) {
  if (data?.ok !== true || typeof data.replay !== "boolean") return null;
  if (typeof data.slot_id !== "string" || (expectedSlotId && data.slot_id !== expectedSlotId)) return null;
  const qty = Number(data.qty);
  if (!Number.isInteger(qty) || qty < 0) return null;
  const arrivedCount = Number(data?.arrived_count);
  if (!Number.isInteger(arrivedCount) || arrivedCount < 0 || arrivedCount > qty) return null;
  const checkedIn = typeof data.checked_in === "boolean" ? data.checked_in : qty > 0 && arrivedCount === qty;
  if (typeof data.checked_in !== "boolean") return null;
  if (data.checked_in_at !== null && typeof data.checked_in_at !== "string") return null;
  return {
    qty,
    arrived_count: arrivedCount,
    checked_in: checkedIn,
    checked_in_at: checkedIn && typeof data.checked_in_at === "string" ? data.checked_in_at : null,
  };
}

function reconcileGuideBooking(bookings: Booking[], update: GuideQueueUpdate) {
  if (update.kind !== "canonical" || !update.canonical) return bookings;
  return bookings.map(booking => {
    if (booking.id !== update.bookingId) return booking;
    const canonical = canonicalArrival(update.canonical, booking, update.slotId);
    return canonical ? { ...booking, ...canonical } : booking;
  });
}

export default function GuideSlotPage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = use(params);
  const { businessId, readOnly } = useBusinessContext();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [slotInfo, setSlotInfo] = useState<{ tour_name: string; start_time: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => { reload(); }, [slotId, businessId]);

  useEffect(() => {
    const onQueueUpdate = (event: Event) => {
      const update = (event as CustomEvent<GuideQueueUpdate>).detail;
      const authority = currentGuideQueueAuthority();
      if (!update || update.slotId !== slotId || !authority
          || authority.userId !== update.userId || authority.businessId !== update.businessId
          || authority.businessId !== businessId) return;
      if (update.kind === "canonical") {
        setBookings(current => reconcileGuideBooking(current, update));
        return;
      }
      notify({
        tone: "warning",
        message: update.reason === "STALE" || update.reason === "STALE_SLOT"
          ? "Trip data changed. Check the current count before retrying the offline check-in."
          : "Offline check-in rejected. Review the booking before retrying.",
      });
    };
    window.addEventListener(GUIDE_QUEUE_UPDATE_EVENT, onQueueUpdate);
    return () => window.removeEventListener(GUIDE_QUEUE_UPDATE_EVENT, onQueueUpdate);
  }, [slotId, businessId]);

  const [loadError, setLoadError] = useState("");
  async function reload() {
    if (!businessId) return;
    setLoading(true);
    setLoadError("");
    try {
    const { data: slot, error: slotError } = await supabase
      .from("slots")
      .select("start_time, tours(name)")
      .eq("id", slotId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (slotError || !slot) throw new Error("Departure unavailable");
    if (slot) setSlotInfo({ tour_name: (slot as any).tours?.name || "Tour", start_time: slot.start_time });

    const result = await supabase.rpc("operator_departure_manifest",{p_business_id:businessId,p_range_start:slot.start_time,p_range_end:new Date(new Date(slot.start_time).getTime()+1).toISOString()});
    if(result.error || !Array.isArray(result.data)) throw new Error("Manifest unavailable");
    const data=result.data.filter((booking:any)=>booking.slot_id===slotId);

    const bookingIds = (data || []).map((b: any) => b.id);
    const addOnsByBooking: Record<string, Array<{ name: string; qty: number }>> = {};
    if (bookingIds.length > 0) {
      const { data: addOnRows } = await supabase
        .from("booking_add_ons")
        .select("booking_id, qty, add_ons(name)")
        .in("booking_id", bookingIds);
      for (const row of (addOnRows || []) as any[]) {
        const ao = Array.isArray(row.add_ons) ? row.add_ons[0] : row.add_ons;
        if (!ao?.name) continue;
        (addOnsByBooking[row.booking_id] ||= []).push({ name: ao.name, qty: row.qty || 1 });
      }
    }

    const nextBookings = (data || []).map((b: any) => ({
      ...b,
      id: b.id,
      customer_name: b.customer_name || "Guest",
      phone: b.phone || "",
      qty: b.qty || 1,
      arrived_count: Math.min(b.qty || 1, Math.max(0, Number(b.arrived_count ?? (b.checked_in ? b.qty : 0)))),
      checked_in: !!b.checked_in,
      checked_in_at: b.checked_in_at || null,
      waiver_status: b.waiver_status || null,
      question_answers: bookingCustomFieldEntries(b.custom_fields),
      add_ons: addOnsByBooking[b.id] || [],
    }));
    setBookings(nextBookings);
    } catch { setLoadError("Departure information is unavailable. Refresh before checking in guests."); setBookings([]); }
    finally { setLoading(false); }
  }

  async function checkIn(bookingId: string) {
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking || !arrivalReadiness(booking).canIncrease) return;
    if (readOnly) {
      notify({ tone: "warning", message: "This demo account is read-only." });
      return;
    }
    const authGeneration = currentGuideQueueAuthGeneration();
    const actionAuthority = currentGuideQueueAuthority();
    const clientEventId = crypto.randomUUID();
    const payload: GuideCheckInPayload = {
      booking_id: bookingId,
      slot_id: slotId,
      arrived_count: null,
      expected_arrived_count: booking.arrived_count,
      client_event_id: clientEventId,
    };

    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, arrived_count: b.qty, checked_in: true, checked_in_at: new Date().toISOString() } : b));

    const restoreOptimisticState = () => {
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, arrived_count: booking.arrived_count, checked_in: booking.checked_in, checked_in_at: booking.checked_in_at } : b));
    };
    const actionIsCurrent = () => mountedRef.current && currentGuideQueueAuthGeneration() === authGeneration;
    const revert = () => {
      if (!actionIsCurrent()) return;
      restoreOptimisticState();
    };

    const { data: { session } } = await supabase.auth.getSession();
    const auth = guideQueueAuthContext(session, businessId);
    if (!auth) {
      const clearedGeneration = await clearGuideQueueAuthContext(authGeneration);
      const currentAuthority = currentGuideQueueAuthority();
      const stillOwnsResult = mountedRef.current && (
        (clearedGeneration !== null && isCurrentGuideQueueAuthClear(clearedGeneration))
        || (!!actionAuthority && !!currentAuthority
          && currentAuthority.generation === actionAuthority.generation
          && currentAuthority.authorityId === actionAuthority.authorityId
          && currentAuthority.userId === actionAuthority.userId
          && currentAuthority.businessId === actionAuthority.businessId)
      );
      if (stillOwnsResult) {
        restoreOptimisticState();
        notify({ tone: "error", message: "Session expired. Sign in to check in guests." });
      }
      return;
    }
    const ownerIsCurrent = () => isCurrentGuideQueueAuthContext(auth, authGeneration);
    const canUpdate = () => mountedRef.current && ownerIsCurrent();
    if (!ownerIsCurrent()) return;

    const persistForResolution = async (
      status: "pending" | "needs_reauth" | "failed",
      lastError?: string,
      serverError?: string,
      committed = false,
      retryAfter: string | null = null,
    ) => {
      if (!committed && !ownerIsCurrent()) return false;
      try {
        const item = createGuideQueueItem(payload, auth);
        await queueGuideCheckIn(status === "pending"
          ? committed ? {
              ...item,
              attempts: 1,
              lastError,
              nextAttemptAt: guideQueueRetryAt(retryAfter),
              updatedAt: Date.now(),
            } : item
          : {
              ...item,
              status,
              attempts: 1,
              lastError,
              serverError: serverError?.slice(0, 160) || null,
              updatedAt: Date.now(),
            });
      } catch {
        if (canUpdate()) {
          revert();
          notify({ tone: "error", message: "Check-in not saved offline. Reconnect and retry." });
        }
        return false;
      }
      if (!canUpdate()) return true;
      if (status !== "pending") {
        await requestGuideQueueStatus().catch(() => {});
        return true;
      }
      const published = await postGuideQueueAuthContext(auth, authGeneration, canUpdate).catch(() => false);
      if (!canUpdate()) return true;
      if (published) {
        if (committed) await requestGuideQueueStatus().catch(() => {});
        else await registerGuideCheckInSync().catch(() => {});
      }
      return true;
    };
    const queueForRetry = (committed = false, retryAfter: string | null = null) =>
      persistForResolution("pending", undefined, undefined, committed, retryAfter);

    if (!navigator.onLine) {
      await queueForRetry();
      return;
    }

    try {
      if (!ownerIsCurrent()) return;
      const r = await fetch("/api/guide/check-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.accessToken}`,
          "x-admin-business-id": auth.businessId,
        },
        body: JSON.stringify(payload),
      });
      let result: any = null;
      try { result = await r.json(); } catch { /* uncertain 2xx is queued below */ }
      if (r.ok) {
        const canonical = canonicalArrival(result, booking, slotId);
        if (result?.ok === true && canonical) {
          if (canUpdate()) setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, ...canonical } : b));
          return;
        }
        await queueForRetry(true);
        return;
      }
      if ([408, 425, 429].includes(r.status) || r.status >= 500) {
        await queueForRetry(true, r.headers.get("Retry-After"));
        return;
      }
      if (r.status < 400 || r.status >= 500) {
        await queueForRetry(true);
        return;
      }

      revert();
      if (r.status === 401) {
        const retained = await persistForResolution("needs_reauth", "unauthorized", result?.error, true);
        await rejectGuideQueueCredential(auth, authGeneration).catch(() => false);
        if (!retained) return;
      } else {
        const reason = typeof result?.code === "string" ? result.code : `http_${r.status}`;
        if (!await persistForResolution("failed", reason, result?.error, true)) return;
      }
      if (canUpdate()) notify({
        tone: "error",
        message: r.status === 401
          ? "Sign in again to check in guests."
          : result?.error || "Check-in rejected. Refresh and try again.",
      });
    } catch {
      await queueForRetry(true);
    }
  }

  if (loadError) return <div role="alert" className="ui-card p-5"><p>{loadError}</p><button className="ui-btn ui-btn-primary mt-3" onClick={reload}>Refresh departure</button></div>;

  const checkedCount = bookings.reduce((sum, b) => sum + b.arrived_count, 0);
  const totalPax = bookings.reduce((s, b) => s + b.qty, 0);
  const pct = totalPax ? Math.round((checkedCount / totalPax) * 100) : 0;

  return (
    <div className="pt-5">
      {/* Trip summary — night surface hero, amber check-in trail */}
      {slotInfo && (
        <div className="bg-bt-dark rounded-2xl p-4 mb-4 text-white" style={{ boxShadow: "var(--ck-shadow-md)" }}>
          <div className="flex items-end justify-between">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold truncate" style={{ color: "rgba(246,243,234,0.75)" }}>{slotInfo.tour_name}</p>
              <p className="font-display text-[28px] font-semibold leading-none tabular-nums mt-0.5">{new Date(slotInfo.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-display text-[24px] font-semibold leading-none tabular-nums">{checkedCount}<span className="text-[16px]" style={{ color: "rgba(246,243,234,0.55)" }}>/{totalPax}</span></p>
              <p className="ui-mono-label mt-1" style={{ color: "rgba(246,243,234,0.75)" }}>guests arrived</p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/15 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: pct + "%", background: "var(--ck-amber-bright)" }} />
          </div>
          <div className="flex items-center justify-between mt-2.5 text-[12px]">
            <span className="font-medium" style={{ color: "rgba(246,243,234,0.75)" }}>{totalPax} guest{totalPax !== 1 ? "s" : ""} aboard</span>
            <Link href={"/guide/photos/" + slotId} className="font-semibold text-white inline-flex items-center gap-1">Trip photos</Link>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-2.5">{[0, 1, 2, 3].map(i => <div key={i} className="ui-skeleton h-[72px] rounded-2xl" />)}</div>
      )}

      {!loading && bookings.length === 0 && (
        <div className="ui-empty mt-6">
          <p className="text-[14px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No passengers on this trip yet.</p>
        </div>
      )}

      <ul className="space-y-2.5">
        {bookings.map(b => (
          <li key={b.id} className={"rounded-2xl border p-3.5 transition-all " + (b.checked_in ? "" : "ui-card")}
            style={b.checked_in ? { background: "var(--ck-success-soft)", borderColor: "color-mix(in srgb, var(--ck-success) 30%, transparent)" } : undefined}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-[15px] truncate" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name}</p>
                  {b.waiver_status === "SIGNED"
                    ? <span className="ui-status ui-pill-success">✓ Waiver</span>
                    : b.waiver_status
                      ? <span className="ui-status ui-pill-danger">Waiver: {b.waiver_status}</span>
                      : null}
                </div>
                <div className="flex items-center gap-3 text-[12px] mt-1">
                  <span className="font-semibold ui-text-muted">{b.qty} guest{b.qty !== 1 ? "s" : ""}</span>
                  <span className="font-semibold" style={{ color: b.arrived_count > 0 ? "var(--ck-success)" : "var(--ck-text-muted)" }}>
                    {b.arrived_count} of {b.qty} arrived
                  </span>
                  {b.phone && (
                    <>
                      <a href={"tel:" + b.phone} className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--ck-ocean)" }}>
                        Call
                      </a>
                      <a href={"https://wa.me/" + b.phone.replace(/\D/g, "").replace(/^0/, "27")} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--ck-success)" }}>
                        WhatsApp
                      </a>
                    </>
                  )}
                </div>
                {b.add_ons.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {b.add_ons.map((ao, idx) => (
                      <span key={idx} className="ui-pill ui-pill-amber text-[11px]">
                        {ao.qty > 1 ? `${ao.qty}× ` : "+ "}{ao.name}
                      </span>
                    ))}
                  </div>
                )}
                {!arrivalReadiness(b).canIncrease && <Link href={bookingResolutionUrl(b.id,"/simple",arrivalReadiness(b).resolutionSection)} className="block mt-2 text-sm underline">{arrivalReadiness(b).resolutionLabel}</Link>}
                {b.question_answers.length > 0 && (
                  <dl className="mt-3 space-y-2 text-[14px]">
                    {b.question_answers.map(answer => (
                      <div key={answer.key} className="min-w-0">
                        <dt className="font-semibold break-words" style={{ color: "var(--ck-text-strong)" }}>{answer.label}</dt>
                        <dd className="whitespace-pre-wrap break-words" style={{ color: "var(--ck-text-muted)" }}>{answer.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              {b.checked_in ? (
                <div className="shrink-0 w-11 h-11 rounded-full text-white flex items-center justify-center" style={{ background: "var(--ck-success)", boxShadow: "var(--ck-shadow-sm)" }}>
                  <Check size={22} weight="bold" />
                </div>
              ) : (
                <button disabled={!arrivalReadiness(b).canIncrease} title={arrivalReadiness(b).resolutionLabel} onClick={() => checkIn(b.id)} className="ui-btn ui-btn-primary shrink-0">
                  {b.arrived_count > 0 ? "Check in rest" : "Check in"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!loading && bookings.length > 0 && (
        <Link href={"/guide/photos/" + slotId}
          className="ui-card ui-card-hover flex items-center justify-center gap-2 mt-6 p-4 font-semibold text-[14px] active:scale-[0.99]"
          style={{ color: "var(--ck-text-strong)" }}>
          Trip photos
        </Link>
      )}
    </div>
  );
}
