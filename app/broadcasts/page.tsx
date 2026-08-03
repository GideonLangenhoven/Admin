"use client";
import { useEffect, useState } from "react";
import { CaretLeft, CaretRight, Check } from "@phosphor-icons/react";
import { confirmAction } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import dynamic from "next/dynamic";
const RichTextEditor = dynamic(() => import("../../components/RichTextEditor"), { ssr: false, loading: () => <div className="ui-skeleton h-40" /> });

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
}

function htmlToPlainText(html: string) {
  if (typeof window === "undefined") return html;
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
}

type SlotData = { id: string; start_time: string; capacity_total: number; booked: number; held: number; status: string; tours: { name: string } };

export default function BroadcastsPage() {
  const { businessId } = useBusinessContext();
  const [vMonth, setVMonth] = useState(new Date().getMonth());
  const [vYear, setVYear] = useState(new Date().getFullYear());
  const [allSlots, setAllSlots] = useState<SlotData[]>([]);
  const [paxByDate, setPaxByDate] = useState<Record<string, number>>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [weatherMode, setWeatherMode] = useState(false);
  const [weatherReason, setWeatherReason] = useState("unfavourable weather conditions");
  const [weatherResult, setWeatherResult] = useState<any>(null);
  const [cancellingWeather, setCancellingWeather] = useState(false);

  useEffect(() => { loadSlots(); loadHistory(); }, [businessId]);

  async function loadSlots() {
    // Start of today in admin timezone, converted back to UTC for the query
    const now = new Date();
    const saDate = new Date(now.toLocaleString("en-US", { timeZone: getAdminTimezone() }));
    saDate.setHours(0, 0, 0, 0);
    // Compute dynamic offset between local-interpreted timezone and UTC
    const offsetMs = saDate.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
    const todayMidnightLocal = new Date(saDate.getTime());
    todayMidnightLocal.setHours(0, 0, 0, 0);
    const todayStart = new Date(todayMidnightLocal.getTime() - offsetMs);
    const future = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const { data } = await supabase.from("slots")
      .select("id, start_time, capacity_total, booked, held, tours(name), status")
      .eq("business_id", businessId)
      .gte("start_time", todayStart.toISOString())
      .lt("start_time", future.toISOString())
      .order("start_time", { ascending: true });
    setAllSlots((data || []) as any);

    const { data: bData } = await supabase.from("bookings")
      .select("qty, status, slots(start_time)")
      .eq("business_id", businessId)
      .in("status", ["PAID", "CONFIRMED", "PENDING", "HELD"])
      .gte("slots.start_time", todayStart.toISOString())
      .lt("slots.start_time", future.toISOString());

    const pByDate: Record<string, number> = {};
    for (const b of (bData || [])) {
      if ((b as any).slots?.start_time) {
        const d = new Date((b as any).slots.start_time).toLocaleDateString("en-CA", { timeZone: getAdminTimezone() });
        pByDate[d] = (pByDate[d] || 0) + b.qty;
      }
    }
    setPaxByDate(pByDate);
  }

  async function loadHistory() {
    const { data } = await supabase.from("broadcasts").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(15);
    setHistory(data || []);
  }

  // Calendar helpers
  const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const firstDay = new Date(vYear, vMonth, 1).getDay();
  const daysInMonth = new Date(vYear, vMonth + 1, 0).getDate();
  const monthName = new Date(vYear, vMonth).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  const now = new Date();
  const canPrev = vYear > now.getFullYear() || (vYear === now.getFullYear() && vMonth > now.getMonth());

  // Slots grouped by date
  const slotsByDate: Record<string, SlotData[]> = {};
  for (const s of allSlots) {
    const d = new Date(s.start_time).toLocaleDateString("en-CA", { timeZone: getAdminTimezone() });
    if (!slotsByDate[d]) slotsByDate[d] = [];
    slotsByDate[d].push(s);
  }

  // Calendar cells
  const cells: { day: number; date: string; isPast: boolean; hasSlots: boolean; bookCount: number }[] = [];
  for (let i = 1; i <= daysInMonth; i++) {
    const ds = vYear + "-" + String(vMonth + 1).padStart(2, "0") + "-" + String(i).padStart(2, "0");
    const isPast = new Date(ds + "T23:59:59") < now;
    const daySlots = slotsByDate[ds] || [];
    const bookCount = paxByDate[ds] || 0;
    cells.push({ day: i, date: ds, isPast, hasSlots: daySlots.length > 0, bookCount });
  }

  // Selected date slots
  const dateSlots = selectedDate ? (slotsByDate[selectedDate] || []) : [];

  function toggleSlot(slotId: string) {
    const next = selectedSlotIds.includes(slotId) ? selectedSlotIds.filter(id => id !== slotId) : [...selectedSlotIds, slotId];
    setSelectedSlotIds(next);
    if (next.length > 0) loadAffected(next);
    else setBookings([]);
  }

  function selectAllDate() {
    const ids = dateSlots.map(s => s.id);
    const allSelected = ids.every(id => selectedSlotIds.includes(id));
    const next = allSelected ? selectedSlotIds.filter(id => !ids.includes(id)) : [...new Set([...selectedSlotIds, ...ids])];
    setSelectedSlotIds(next);
    if (next.length > 0) loadAffected(next);
    else setBookings([]);
  }

  async function loadAffected(slotIds: string[]) {
    setLoadingBookings(true);
    const { data } = await supabase.from("bookings")
      .select("id, customer_name, phone, email, qty, total_amount, status, slots(start_time), tours(name)")
      .eq("business_id", businessId)
      .in("slot_id", slotIds)
      .in("status", ["PAID", "CONFIRMED"]);
    setBookings(data || []);
    setLoadingBookings(false);
  }

  async function sendBroadcast() {
    const plainMessage = htmlToPlainText(message);
    if (!plainMessage.trim() || selectedSlotIds.length === 0 || bookings.length === 0) return;
    if (!await confirmAction({
      title: "Send broadcast",
      message: "Send to " + bookings.length + " customers via WhatsApp and email?",
      tone: "info",
      confirmLabel: "Send broadcast",
    })) return;
    setSending(true); setResult(null);
    try {
      // broadcast requires the admin's JWT — it derives the target business
      // from the caller's admin row, not the request body.
      const token = (await supabase.auth.getSession()).data.session?.access_token || SK;
      const r = await fetch(SU + "/functions/v1/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: SK },
        body: JSON.stringify({ action: "broadcast_targeted", message: plainMessage, target_group: "SLOT", slot_ids: selectedSlotIds, send_email: true, send_whatsapp: true, business_id: businessId }),
      });
      const d = await r.json();
      setResult(d);
      if (!d.error) { setMessage(""); setSelectedSlotIds([]); setBookings([]); }
      loadHistory();
    } catch (e) { setResult({ error: String(e) }); }
    setSending(false);
  }

  async function sendWeatherCancel() {
    if (selectedSlotIds.length === 0) return;
    if (!await confirmAction({
      title: "Cancel selected slots",
      message: "Cancel " + selectedSlotIds.length + " slot(s) and notify " + bookings.length + " customer(s)? This will close each slot, cancel all bookings, and send WhatsApp plus email with self-service options.",
      tone: "warning",
      confirmLabel: "Cancel slots",
    })) return;
    setCancellingWeather(true); setWeatherResult(null);

    try {
      // Delegate to the weather-cancel edge function: the single source of truth
      // for slot closure, tenant-scoped booking cancellation, atomic capacity
      // release, refund_status ACTION_REQUIRED, and customer notifications.
      const { data, error } = await supabase.functions.invoke("weather-cancel", {
        body: { slot_ids: selectedSlotIds, business_id: businessId, reason: weatherReason, log_broadcast: true },
      });
      if (error) throw error;
      setWeatherResult({ affected: (data as any)?.bookings_cancelled ?? 0, sent: (data as any)?.notified ?? 0 });
      setSelectedSlotIds([]); setBookings([]); setSelectedDate(null);
      loadSlots(); loadHistory();
    } catch (e) {
      setWeatherResult({ error: e instanceof Error ? e.message : String(e) });
    }

    setCancellingWeather(false);
  }

  return (
    <div className="max-w-6xl">
      <div className="anim-fade-up mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ui-mono-label mb-2">Customer Messaging</p>
          <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Broadcasts</h1>
        </div>
        <button onClick={() => { setWeatherMode(!weatherMode); setWeatherResult(null); }}
          className={"ui-btn w-full sm:w-auto " + (weatherMode ? "ui-btn-danger" : "ui-btn-ghost")}>
          {weatherMode ? "Weather Mode ON" : "Weather Cancel"}
        </button>
      </div>

      <div className="anim-fade-up anim-d1 grid gap-6 lg:grid-cols-12">
        {/* Calendar */}
        <div className="lg:col-span-4">
          <div className="ui-card p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => { if (vMonth === 0) { setVMonth(11); setVYear(vYear - 1); } else setVMonth(vMonth - 1); }}
                disabled={!canPrev} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--ck-surface-sunken)] disabled:opacity-20" style={{ color: "var(--ck-text)" }} aria-label="Previous month"><CaretLeft size={14} /></button>
              <span className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{monthName}</span>
              <button onClick={() => { if (vMonth === 11) { setVMonth(0); setVYear(vYear + 1); } else setVMonth(vMonth + 1); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--ck-surface-sunken)]" style={{ color: "var(--ck-text)" }} aria-label="Next month"><CaretRight size={14} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {dayNames.map(d => <div key={d} className="ui-mono-label !text-[10px] text-center py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }, (_, i) => <div key={"e" + i} />)}
              {cells.map(c => {
                if (c.isPast || !c.hasSlots) return <div key={c.date} className="text-center py-2 text-sm rounded-lg" style={{ color: "var(--ck-text-muted)", opacity: 0.5 }}>{c.day}</div>;
                const isSelected = selectedDate === c.date;
                const hasSelectedSlots = (slotsByDate[c.date] || []).some(s => selectedSlotIds.includes(s.id));
                return (
                  <button key={c.date} onClick={() => { setSelectedDate(c.date); }}
                    className={"text-center py-2 text-sm font-semibold rounded-lg transition-colors relative " +
                      (!isSelected && !hasSelectedSlots ? "hover:bg-[var(--ck-surface-sunken)]" : "")}
                    style={
                      isSelected ? { background: "var(--ck-accent)", color: "var(--ck-btn-primary-text)" }
                      : hasSelectedSlots ? { background: "var(--ck-ocean-soft)", color: "var(--ck-ocean)" }
                      : { color: "var(--ck-text-strong)" }
                    }>
                    {c.day}
                    {c.bookCount > 0 && !isSelected && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold tabular-nums" style={{ color: "var(--ck-success)" }}>{c.bookCount}</span>
                    )}
                    {c.bookCount === 0 && !isSelected && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: "var(--ck-border-strong)" }}></span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="ui-mono-label !text-[10px] !tracking-[0.06em] text-center mt-2 normal-case">Numbers = booked guests</p>
          </div>

          {/* Slots for selected date */}
          {selectedDate && (
            <div className="ui-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>
                  {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}
                </h3>
                <button onClick={selectAllDate} className="text-xs font-medium transition-colors hover:opacity-80" style={{ color: "var(--ck-accent)" }}>
                  {dateSlots.every(s => selectedSlotIds.includes(s.id)) ? "Deselect All" : "Select All"}
                </button>
              </div>
              <div className="space-y-2">
                {dateSlots.map(s => {
                  const isSelected = selectedSlotIds.includes(s.id);
                  const booked = s.booked;
                  return (
                    <button key={s.id} onClick={() => toggleSlot(s.id)}
                      className="w-full text-left flex items-center gap-3 p-3 rounded-lg border transition-colors"
                      style={isSelected
                        ? { borderColor: "var(--ck-ocean)", background: "var(--ck-ocean-soft)" }
                        : { borderColor: "var(--ck-border-subtle)" }}>
                      <span className="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0"
                        style={isSelected
                          ? { background: "var(--ck-accent)", borderColor: "var(--ck-accent)", color: "var(--ck-btn-primary-text)" }
                          : { borderColor: "var(--ck-border-strong)" }}>
                        {isSelected ? <Check size={12} weight="bold" /> : null}
                      </span>
                      <div className="flex-1">
                        <p className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>{(s as any).tours?.name}</p>
                        <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                          {fmtTime(s.start_time)}
                          {s.status !== "OPEN" && <span className="ml-1 font-medium" style={{ color: "var(--ck-danger)" }}>· {s.status}</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-sm font-semibold tabular-nums" style={{ color: booked > 0 ? "var(--ck-success)" : "var(--ck-text-muted)" }}>{booked}</p>
                        <p className="ui-mono-label !text-[9px]">booked</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right side: customers + compose */}
        <div className="lg:col-span-8 space-y-4">
          {/* Selected summary */}
          <div className="ui-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>
                <span className="font-display tabular-nums">{selectedSlotIds.length}</span> slot{selectedSlotIds.length !== 1 ? "s" : ""} selected
              </p>
              <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                <span className="font-display tabular-nums" style={{ color: "var(--ck-text)" }}>{bookings.length}</span> customer{bookings.length !== 1 ? "s" : ""} will be notified
              </p>
            </div>
            {selectedSlotIds.length > 0 && (
              <button onClick={() => { setSelectedSlotIds([]); setBookings([]); }} className="text-xs font-medium transition-colors hover:opacity-80" style={{ color: "var(--ck-text-muted)" }}>Clear All</button>
            )}
          </div>

          {/* Affected customers — loading skeleton */}
          {loadingBookings && bookings.length === 0 && (
            <div className="ui-card p-4 space-y-2">
              <div className="ui-skeleton h-4 w-32" />
              <div className="ui-skeleton h-11" />
              <div className="ui-skeleton h-11" />
            </div>
          )}

          {/* Affected customers */}
          {bookings.length > 0 && (
            <div className="ui-card p-4">
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--ck-text-strong)" }}>
                Customers <span className="font-display tabular-nums">({bookings.length})</span>
              </h3>
              <div className="space-y-2 sm:hidden">
                {bookings.map(b => (
                  <div key={b.id} className="rounded-lg border p-3" style={{ borderColor: "var(--ck-border-subtle)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name}</p>
                        <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{(b as any).tours?.name || "—"} · {(b as any).slots?.start_time ? fmtTime((b as any).slots.start_time) : "—"}</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--ck-text)" }}>{b.qty} pax</p>
                    </div>
                    <p className="mt-2 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                      {b.phone ? "WhatsApp" : ""}{b.phone && b.email ? " · " : ""}{b.email ? "Email" : "No contact"}
                    </p>
                  </div>
                ))}
              </div>
              <div className="hidden max-h-48 overflow-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--ck-border-subtle)" }}>
                      <th className="text-left py-2 ui-mono-label !text-[10px]">Name</th>
                      <th className="hidden text-left py-2 ui-mono-label !text-[10px] md:table-cell">Tour</th>
                      <th className="hidden text-left py-2 ui-mono-label !text-[10px] sm:table-cell">Time</th>
                      <th className="text-center py-2 ui-mono-label !text-[10px]">Pax</th>
                      <th className="text-center py-2 ui-mono-label !text-[10px]">Channels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map(b => (
                      <tr key={b.id} className="border-b" style={{ borderColor: "var(--ck-border-subtle)" }}>
                        <td className="py-2 font-medium" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name}</td>
                        <td className="hidden py-2 md:table-cell" style={{ color: "var(--ck-text-muted)" }}>{(b as any).tours?.name}</td>
                        <td className="hidden py-2 sm:table-cell" style={{ color: "var(--ck-text-muted)" }}>{(b as any).slots?.start_time ? fmtTime((b as any).slots.start_time) : "—"}</td>
                        <td className="py-2 text-center tabular-nums" style={{ color: "var(--ck-text)" }}>{b.qty}</td>
                        <td className="py-2">
                          <div className="flex items-center justify-center gap-1">
                            {b.phone && (
                              <span
                                className="ui-status ui-pill-success"
                                title="WhatsApp will be attempted. Actual delivery depends on whether this number is registered with WhatsApp and within the 24h service window."
                              >
                                WA?
                              </span>
                            )}
                            {b.email && <span className="ui-status ui-pill-ocean" title="Email">Email</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Compose */}
          {weatherMode ? (
            <div className="ui-card p-5" style={{ borderColor: "var(--ck-danger-soft)" }}>
              <div className="flex items-center gap-2.5 mb-2">
                <h2 className="text-lg font-semibold" style={{ color: "var(--ck-danger)" }}>Weather Cancellation</h2>
              </div>
              <p className="text-sm mb-4" style={{ color: "var(--ck-text-muted)" }}>Cancels selected slots, sends refund/reschedule options via WhatsApp, and a professional cancellation email.</p>
              <div className="mb-4">
                <label className="ui-mono-label !text-[10px] block mb-1.5">Reason</label>
                <input type="text" value={weatherReason} onChange={e => setWeatherReason(e.target.value)}
                  className="ui-control w-full" />
              </div>
              <button onClick={sendWeatherCancel} disabled={cancellingWeather || selectedSlotIds.length === 0}
                className="ui-btn w-full !h-11 disabled:opacity-50"
                style={{ background: "var(--ck-danger)", color: "#fff" }}>
                {cancellingWeather
                  ? "Cancelling..."
                  : bookings.length === 0
                    ? "Close " + selectedSlotIds.length + " Empty Slot" + (selectedSlotIds.length === 1 ? "" : "s")
                    : "Cancel & Notify " + bookings.length + " Customer" + (bookings.length === 1 ? "" : "s")}
              </button>
              {weatherResult && (
                <div className="text-sm p-3 rounded-lg mt-3"
                  style={weatherResult.error
                    ? { background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }
                    : { background: "var(--ck-warning-soft)", color: "var(--ck-warning)" }}>
                  {weatherResult.error ? "Error: " + weatherResult.error : "Cancelled " + (weatherResult.affected || 0) + " bookings, notified " + (weatherResult.sent || 0)}
                </div>
              )}
            </div>
          ) : (
            <div className="ui-card p-5">
              <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--ck-text-strong)" }}>Compose</h2>
              <div className="space-y-3">
                <div>
                  <label className="ui-mono-label !text-[10px] block mb-1.5">WhatsApp Message</label>
                  <RichTextEditor
                    value={message}
                    onChange={setMessage}
                    rows={6}
                    placeholder="Hi {name}, just a quick message about your upcoming paddle..."
                  />
                  <p className="text-xs mt-1" style={{ color: "var(--ck-text-muted)" }}>
                    Use &#123;name&#125; for the customer&apos;s first name. Formatting helps the email version; WhatsApp sends a cleaned text version.
                  </p>
                </div>
                <button onClick={sendBroadcast} disabled={sending || !htmlToPlainText(message).trim() || selectedSlotIds.length === 0 || bookings.length === 0}
                  className="ui-btn ui-btn-primary w-full !h-11 disabled:opacity-50">
                  {sending ? "Sending..." : "Send to " + bookings.length + " Customers (email + WhatsApp where possible)"}
                </button>
                {result && (() => {
                  if (result.error) {
                    return <div className="text-sm p-3 rounded-lg" style={{ background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }}>Error: {result.error}</div>;
                  }
                  const waSent = result.wa_sent || 0;
                  const waAtt = result.wa_attempted ?? waSent;
                  const emSent = result.email_sent || 0;
                  const emAtt = result.email_attempted ?? emSent;
                  const anyFailed = (waAtt > 0 && waSent < waAtt) || (emAtt > 0 && emSent < emAtt);
                  return (
                    <div className="text-sm p-3 rounded-lg"
                      style={anyFailed
                        ? { background: "var(--ck-warning-soft)", color: "var(--ck-warning)" }
                        : { background: "var(--ck-success-soft)", color: "var(--ck-success)" }}>
                      <p className="tabular-nums">
                        WhatsApp: {waSent} of {waAtt} delivered · Email: {emSent} of {emAtt} delivered
                      </p>
                      {anyFailed && Array.isArray(result.errors) && result.errors.length > 0 && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer font-semibold">Why some failed ({result.errors.length})</summary>
                          <ul className="mt-1 list-disc pl-5 space-y-0.5">
                            {result.errors.slice(0, 5).map((e: string, i: number) => <li key={i} className="break-all">{e}</li>)}
                            {result.errors.length > 5 && <li>… and {result.errors.length - 5} more.</li>}
                          </ul>
                        </details>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* History */}
          <div className="ui-card p-5">
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--ck-text-strong)" }}>Recent Broadcasts</h2>
            {history.length === 0 ? (
              <div className="ui-empty !py-8">
                <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>No broadcasts sent yet.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-auto">
                {history.map(h => (
                  <div key={h.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-3" style={{ borderColor: "var(--ck-border-subtle)" }}>
                    <span className={"ui-status shrink-0 " + (h.target_group === "AFFECTED_BOOKINGS" ? "ui-pill-danger" : "ui-pill-ocean")}>
                      {h.target_group === "AFFECTED_BOOKINGS" ? "WX" : "BC"}
                    </span>
                    <p className="text-sm flex-1 line-clamp-1" style={{ color: "var(--ck-text)" }}>{h.message}</p>
                    <span className="text-xs shrink-0 tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{h.sent_count} sent</span>
                    <span className="text-xs shrink-0 tabular-nums" style={{ color: "var(--ck-text-muted)", opacity: 0.7 }}>{new Date(h.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
