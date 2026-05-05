"use client";
import { useEffect, useState } from "react";
import { confirmAction } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import dynamic from "next/dynamic";
const RichTextEditor = dynamic(() => import("../../components/RichTextEditor"), { ssr: false, loading: () => <div className="h-40 bg-gray-100 rounded animate-pulse" /> });

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
  const [manageBookingUrl, setManageBookingUrl] = useState("");
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

  useEffect(() => { loadSlots(); loadHistory(); loadBusinessLinks(); }, [businessId]);

  async function loadBusinessLinks() {
    const { data } = await supabase.from("businesses").select("booking_site_url, manage_bookings_url").eq("id", businessId).maybeSingle();
    const bookingSiteUrl = String(data?.booking_site_url || "").replace(/\/+$/, "");
    setManageBookingUrl(data?.manage_bookings_url || (bookingSiteUrl ? bookingSiteUrl + "/my-bookings" : ""));
  }

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
      const r = await fetch(SU + "/functions/v1/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
        body: JSON.stringify({ action: "broadcast_targeted", message: plainMessage, target_group: "SLOT", slot_ids: selectedSlotIds, send_email: true, send_whatsapp: true, business_id: businessId }),
      });
      const d = await r.json();
      setResult(d);
      if (!d.error) { setMessage(""); setSelectedSlotIds([]); setBookings([]); }
      loadHistory();
    } catch (e) { setResult({ error: String(e) }); }
    setSending(false);
  }

  function fmtDateTime(iso: string) {
    return new Date(iso).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
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

    let totalAffected = 0;
    let totalSent = 0;

    try {
      for (const slotId of selectedSlotIds) {
        // Close the slot
        await supabase.from("slots").update({ status: "CLOSED" }).eq("id", slotId);

        // Fetch all active bookings on this slot
        const { data: slotBookings } = await supabase
          .from("bookings")
          .select("id, customer_name, phone, email, qty, total_amount, status, tours(name), slots(start_time)")
          .eq("business_id", businessId)
          .eq("slot_id", slotId)
          .in("status", ["PAID", "CONFIRMED", "HELD", "PENDING"]);

        const affected = slotBookings || [];

        for (const b of affected) {
          // Cancel booking (no auto-refund — customer chooses)
          await supabase.from("bookings").update({
            status: "CANCELLED",
            cancellation_reason: "Weather cancellation: " + weatherReason,
            cancelled_at: new Date().toISOString(),
          }).eq("id", b.id);

          // Release capacity
          const slotData = await supabase.from("slots").select("booked, held").eq("id", slotId).single();
          if (slotData.data) {
            await supabase.from("slots").update({
              booked: Math.max(0, slotData.data.booked - b.qty),
              held: Math.max(0, (slotData.data.held || 0) - (b.status === "HELD" ? b.qty : 0)),
            }).eq("id", slotId);
          }

          // Cancel active holds
          await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", b.id).eq("status", "ACTIVE");

          const ref = b.id.substring(0, 8).toUpperCase();
          const tourName = (b as any).tours?.name || "Tour";
          const startTime = (b as any).slots?.start_time ? fmtDateTime((b as any).slots.start_time) : "";
          const paidAmount = Number(b.total_amount || 0);

          // WhatsApp notification — with 3 options
          if (b.phone) {
            try {
              await fetch(SU + "/functions/v1/send-whatsapp-text", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
                body: JSON.stringify({
                  business_id: businessId,
                  to: b.phone,
                  message: "\u26C8 *Trip Cancelled \u2014 Weather*\n\n" +
                    "Hi " + (b.customer_name?.split(" ")[0] || "there") + ", unfortunately your " + tourName + " on " + startTime +
                    " has been cancelled due to " + weatherReason + ".\n\n" +
                    "\uD83D\uDCCB Ref: " + ref + "\n" +
                    (paidAmount > 0 ? "\uD83D\uDCB0 Amount paid: R" + paidAmount + "\n" : "") +
                    "\nPlease choose how you\u2019d like us to handle your booking:\n\n" +
                    "1\uFE0F\u20E3 *Reschedule* \u2014 Pick a new date\n" +
                    "2\uFE0F\u20E3 *Voucher* \u2014 Get a voucher for a future trip\n" +
                    "3\uFE0F\u20E3 *Refund* \u2014 Request a full refund\n\n" +
                    "\uD83D\uDC49 Manage your booking: " + manageBookingUrl + "\n\n" +
                    "Or reply here with your choice and we\u2019ll sort it out for you \uD83D\uDEF6",
                }),
              });
              totalSent++;
            } catch (e) { console.error("WA err:", e); }
          }

          // Email notification — with 3 option buttons
          if (b.email) {
            try {
              await supabase.functions.invoke("send-email", {
                body: {
                  type: "CANCELLATION",
                  data: {
                    business_id: businessId,
                    email: b.email,
                    customer_name: b.customer_name || "Guest",
                    ref,
                    tour_name: tourName,
                    start_time: startTime,
                    reason: weatherReason,
                    total_amount: paidAmount > 0 ? paidAmount : null,
                  },
                },
              });
              totalSent++;
            } catch (e) { console.error("Email err:", e); }
          }

          totalAffected++;
        }
      }

      // Log as broadcast
      try {
        await supabase.from("broadcasts").insert({
          message: "\u26C8 Weather cancellation: " + weatherReason,
          target_group: "AFFECTED_BOOKINGS",
          sent_count: totalSent,
          business_id: businessId,
        });
      } catch (_) { }

      setWeatherResult({ affected: totalAffected, sent: totalSent });
      setSelectedSlotIds([]); setBookings([]); setSelectedDate(null);
      loadSlots(); loadHistory();
    } catch (e) {
      setWeatherResult({ error: String(e) });
    }

    setCancellingWeather(false);
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Broadcasts</h1>
        <button onClick={() => { setWeatherMode(!weatherMode); setWeatherResult(null); }}
          className={"w-full rounded-lg border px-4 py-2 text-sm font-semibold transition-colors sm:w-auto " + (weatherMode ? "bg-red-600 text-white border-red-600" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50")}>
          {weatherMode ? "Weather Mode ON" : "Weather Cancel"}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Calendar */}
        <div className="lg:col-span-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => { if (vMonth === 0) { setVMonth(11); setVYear(vYear - 1); } else setVMonth(vMonth - 1); }}
                disabled={!canPrev} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-20">◀</button>
              <span className="text-sm font-semibold">{monthName}</span>
              <button onClick={() => { if (vMonth === 11) { setVMonth(0); setVYear(vYear + 1); } else setVMonth(vMonth + 1); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100">▶</button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {dayNames.map(d => <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }, (_, i) => <div key={"e" + i} />)}
              {cells.map(c => {
                if (c.isPast || !c.hasSlots) return <div key={c.date} className="text-center py-2 text-sm text-gray-300 rounded-lg">{c.day}</div>;
                const isSelected = selectedDate === c.date;
                const hasSelectedSlots = (slotsByDate[c.date] || []).some(s => selectedSlotIds.includes(s.id));
                return (
                  <button key={c.date} onClick={() => { setSelectedDate(c.date); }}
                    className={"text-center py-2 text-sm font-semibold rounded-lg transition-colors relative " +
                      (isSelected ? "bg-gray-900 text-white" : hasSelectedSlots ? "bg-blue-100 text-blue-800" : "text-gray-900 hover:bg-gray-100")}>
                    {c.day}
                    {c.bookCount > 0 && !isSelected && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] text-emerald-600 font-bold">{c.bookCount}</span>
                    )}
                    {c.bookCount === 0 && !isSelected && (
                      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gray-300"></span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 text-center mt-2">Numbers = booked guests</p>
          </div>

          {/* Slots for selected date */}
          {selectedDate && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">
                  {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}
                </h3>
                <button onClick={selectAllDate} className="text-xs text-blue-600 font-medium hover:text-blue-800">
                  {dateSlots.every(s => selectedSlotIds.includes(s.id)) ? "Deselect All" : "Select All"}
                </button>
              </div>
              <div className="space-y-2">
                {dateSlots.map(s => {
                  const isSelected = selectedSlotIds.includes(s.id);
                  const booked = s.booked;
                  return (
                    <button key={s.id} onClick={() => toggleSlot(s.id)}
                      className={"w-full text-left flex items-center gap-3 p-3 rounded-lg border transition-colors " +
                        (isSelected ? "border-blue-400 bg-blue-50" : "border-gray-100 hover:border-gray-200")}>
                      <span className={"w-5 h-5 rounded border-2 flex items-center justify-center text-xs font-bold " +
                        (isSelected ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300")}>
                        {isSelected ? "✓" : ""}
                      </span>
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{(s as any).tours?.name}</p>
                        <p className="text-xs text-gray-400">
                          {fmtTime(s.start_time)}
                          {s.status !== "OPEN" && <span className="ml-1 text-red-500 font-medium">· {s.status}</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={"text-sm font-bold " + (booked > 0 ? "text-emerald-600" : "text-gray-300")}>{booked}</p>
                        <p className="text-xs text-gray-400">booked</p>
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
          <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="font-semibold text-sm">{selectedSlotIds.length} slot{selectedSlotIds.length !== 1 ? "s" : ""} selected</p>
              <p className="text-xs text-gray-400">{bookings.length} customer{bookings.length !== 1 ? "s" : ""} will be notified</p>
            </div>
            {selectedSlotIds.length > 0 && (
              <button onClick={() => { setSelectedSlotIds([]); setBookings([]); }} className="text-xs text-gray-500 hover:text-gray-800">Clear All</button>
            )}
          </div>

          {/* Affected customers */}
          {bookings.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="font-semibold text-sm mb-3">Customers ({bookings.length})</h3>
              <div className="space-y-2 sm:hidden">
                {bookings.map(b => (
                  <div key={b.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">{b.customer_name}</p>
                        <p className="text-xs text-gray-500">{(b as any).tours?.name || "—"} · {(b as any).slots?.start_time ? fmtTime((b as any).slots.start_time) : "—"}</p>
                      </div>
                      <p className="text-sm font-semibold text-gray-700">{b.qty} pax</p>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      {b.phone ? "WhatsApp" : ""}{b.phone && b.email ? " · " : ""}{b.email ? "Email" : "No contact"}
                    </p>
                  </div>
                ))}
              </div>
              <div className="hidden max-h-48 overflow-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-left py-2 font-medium">Name</th>
                      <th className="hidden text-left py-2 font-medium md:table-cell">Tour</th>
                      <th className="hidden text-left py-2 font-medium sm:table-cell">Time</th>
                      <th className="text-center py-2 font-medium">Pax</th>
                      <th className="text-center py-2 font-medium">Channels</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map(b => (
                      <tr key={b.id} className="border-b border-gray-50">
                        <td className="py-2 font-medium">{b.customer_name}</td>
                        <td className="hidden py-2 text-gray-500 md:table-cell">{(b as any).tours?.name}</td>
                        <td className="hidden py-2 text-gray-500 sm:table-cell">{(b as any).slots?.start_time ? fmtTime((b as any).slots.start_time) : "—"}</td>
                        <td className="py-2 text-center">{b.qty}</td>
                        <td className="py-2 text-center">
                          {b.phone && <span className="text-emerald-600 mr-1 text-xs font-medium" title="WhatsApp">WA</span>}
                          {b.email && <span className="text-blue-600 text-xs font-medium" title="Email">Email</span>}
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
            <div className="bg-red-50 border border-red-200 rounded-xl p-5">
              <h2 className="font-semibold text-lg text-red-800 mb-2">Weather Cancellation</h2>
              <p className="text-sm text-red-600 mb-4">Cancels selected slots, sends refund/reschedule options via WhatsApp, and a professional cancellation email.</p>
              <div className="mb-4">
                <label className="text-xs text-red-700 font-medium block mb-1">Reason</label>
                <input type="text" value={weatherReason} onChange={e => setWeatherReason(e.target.value)}
                  className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm bg-white" />
              </div>
              <button onClick={sendWeatherCancel} disabled={cancellingWeather || selectedSlotIds.length === 0}
                className="w-full bg-red-600 text-white py-3 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                {cancellingWeather ? "Cancelling..." : "Cancel & Notify " + bookings.length + " Customers"}
              </button>
              {weatherResult && (
                <div className={"text-sm p-3 rounded-lg mt-3 " + (weatherResult.error ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
                  {weatherResult.error ? "Error: " + weatherResult.error : "Cancelled " + (weatherResult.affected || 0) + " bookings, notified " + (weatherResult.sent || 0)}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="font-semibold text-lg mb-3">Compose</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium block mb-1">WhatsApp Message</label>
                  <RichTextEditor
                    value={message}
                    onChange={setMessage}
                    rows={6}
                    placeholder="Hi {name}, just a quick message about your upcoming paddle..."
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Use &#123;name&#125; for the customer&apos;s first name. Formatting helps the email version; WhatsApp sends a cleaned text version.
                  </p>
                </div>
                <button onClick={sendBroadcast} disabled={sending || !htmlToPlainText(message).trim() || selectedSlotIds.length === 0 || bookings.length === 0}
                  className="w-full bg-gray-900 text-white py-3 rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50">
                  {sending ? "Sending..." : "Send to " + bookings.length + " Customers (WhatsApp + Email)"}
                </button>
                {result && (
                  <div className={"text-sm p-3 rounded-lg " + (result.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
                    {result.error ? "Error: " + result.error : (result.wa_sent || 0) + " WhatsApp + " + (result.email_sent || 0) + " emails sent"}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* History */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold mb-3">Recent Broadcasts</h2>
            {history.length === 0 ? <p className="text-sm text-gray-400">None yet.</p> : (
              <div className="space-y-2 max-h-48 overflow-auto">
                {history.map(h => (
                  <div key={h.id} className="flex flex-col gap-2 rounded-lg border border-gray-100 p-3 sm:flex-row sm:items-center sm:gap-3">
                    <span className={"text-xs font-medium px-2 py-0.5 rounded-full shrink-0 " + (h.target_group === "AFFECTED_BOOKINGS" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700")}>
                      {h.target_group === "AFFECTED_BOOKINGS" ? "WX" : "BC"}
                    </span>
                    <p className="text-sm text-gray-700 flex-1 line-clamp-1">{h.message}</p>
                    <span className="text-xs text-gray-400 shrink-0">{h.sent_count} sent</span>
                    <span className="text-xs text-gray-300 shrink-0">{new Date(h.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}</span>
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
