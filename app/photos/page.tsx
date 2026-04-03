"use client";
import { useEffect, useState } from "react";
import { confirmAction, notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";

var SU = process.env.NEXT_PUBLIC_SUPABASE_URL!;
var SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: getAdminTimezone() });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
}

type SlotGroup = { date: string; label: string; slots: any[] };

export default function PhotosPage() {
  var { businessId } = useBusinessContext();
  var [bookingSiteUrl, setBookingSiteUrl] = useState("");
  var [slots, setSlots] = useState<SlotGroup[]>([]);
  var [selectedSlot, setSelectedSlot] = useState<any>(null);
  var [urls, setUrls] = useState<string[]>([""]);
  var [sending, setSending] = useState(false);
  var [result, setResult] = useState<any>(null);
  var [sentHistory, setSentHistory] = useState<any[]>([]);
  var [bulkInput, setBulkInput] = useState("");
  var [sendProgress, setSendProgress] = useState(0);

  useEffect(() => { loadSlots(); loadHistory(); loadBusinessLinks(); }, [businessId]);

  async function loadBusinessLinks() {
    var { data } = await supabase.from("businesses").select("booking_site_url").eq("id", businessId).maybeSingle();
    setBookingSiteUrl(data?.booking_site_url || "");
  }

  async function loadSlots() {
    var past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    var now = new Date().toISOString();
    var { data } = await supabase.from("slots")
      .select("id, start_time, booked, tours(name)")
      .eq("business_id", businessId)
      .gt("booked", 0)
      .lt("start_time", now)
      .gt("start_time", past)
      .order("start_time", { ascending: false });
    var groups: Record<string, SlotGroup> = {};
    for (var s of (data || [])) {
      var d = new Date(s.start_time).toISOString().split("T")[0];
      if (!groups[d]) groups[d] = { date: d, label: fmtDate(s.start_time), slots: [] };
      groups[d].slots.push(s);
    }
    setSlots(Object.values(groups));
  }

  async function loadHistory() {
    var { data } = await supabase.from("trip_photos")
      .select("id, photo_url, uploaded_at, slots(start_time, tours(name))")
      .eq("business_id", businessId)
      .order("uploaded_at", { ascending: false })
      .limit(20);
    setSentHistory(data || []);
  }

  function addUrl() { setUrls([...urls, ""]); }
  function removeUrl(i: number) { setUrls(urls.filter((_, idx) => idx !== i)); }
  function updateUrl(i: number, v: string) { var n = [...urls]; n[i] = v; setUrls(n); }
  function importBulkUrls() {
    var next = bulkInput
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (next.length === 0) return;
    setUrls(next);
    setBulkInput("");
  }

  async function sendPhotos() {
    if (!selectedSlot) { notify({ title: "Select a trip", message: "Select a trip slot first.", tone: "warning" }); return; }
    var validUrls = urls.filter(u => u.trim().length > 0);
    if (validUrls.length === 0) { notify({ title: "No photo links", message: "Add at least one photo URL.", tone: "warning" }); return; }
    if (!await confirmAction({
      title: "Send trip photos",
      message: "Send photos and a thank-you email to all guests on this trip?",
      tone: "info",
      confirmLabel: "Send photos",
    })) return;

    setSending(true);
    setResult(null);
    setSendProgress(10);
    try {
      var tourName = (selectedSlot as any).tours?.name || "kayak trip";
      var photoLink = validUrls.length === 1 ? validUrls[0] : validUrls[0];

      // Fetch bookings for this slot
      var { data: bookings } = await supabase.from("bookings")
        .select("id, customer_name, phone, email, status")
        .eq("business_id", businessId)
        .eq("slot_id", selectedSlot.id)
        .in("status", ["PAID", "CONFIRMED", "COMPLETED"]);
      setSendProgress(35);

      var sent = 0;
      for (var b of (bookings || [])) {
        // Send WhatsApp with photo links
        if (b.phone) {
          var waMsg = "Hi " + (b.customer_name?.split(" ")[0] || "there") +
            "! 📸 Thank you for joining us on the " + tourName +
            "! Here are your trip photos:\n\n" +
            validUrls.join("\n") +
            "\n\nWe hope you had an amazing time and would love to see you again! Book your next adventure at " + bookingSiteUrl;
          try {
            await fetch(SU + "/functions/v1/send-whatsapp-text", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
              body: JSON.stringify({ business_id: businessId, to: b.phone, message: waMsg }),
            });
          } catch { }
        }

        // Send thank-you email with photo link
        if (b.email) {
          try {
            await fetch(SU + "/functions/v1/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
              body: JSON.stringify({
                type: "TRIP_PHOTOS",
                data: {
                  business_id: businessId,
                  email: b.email,
                  customer_name: b.customer_name || "Guest",
                  tour_name: tourName,
                  photo_url: photoLink,
                },
              }),
            });
          } catch { }
        }
        sent++;
        setSendProgress(35 + Math.round((sent / Math.max((bookings || []).length, 1)) * 45));
      }

      // Log to trip_photos
      for (var url of validUrls) {
        await supabase.from("trip_photos").insert({ slot_id: selectedSlot.id, photo_url: url, business_id: businessId });
      }
      setSendProgress(100);

      setResult({ sent });
      if (sent > 0) { setUrls([""]); setSelectedSlot(null); }
      loadHistory();
    } catch (e) { setResult({ error: String(e) }); }
    setSendProgress(0);
    setSending(false);
  }

  var validUrls = urls.filter(u => u.trim().length > 0);

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">📸 Trip Photos</h1>
      <p className="text-sm text-gray-500">Send trip photos and a thank-you email to guests. Select a recent trip, add a batch of links, and confirm the gallery preview before sending.</p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Select Trip */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="font-semibold mb-3">Select Trip (Last 7 Days)</h2>
          {slots.length === 0 ? (
            <p className="text-sm text-gray-400">No recent trips with bookings.</p>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-auto">
              {slots.map(group => (
                <div key={group.date}>
                  <p className="text-xs font-semibold text-gray-400 mb-1">{group.label}</p>
                  {group.slots.map(s => {
                    var isSelected = selectedSlot?.id === s.id;
                    return (
                      <button key={s.id} onClick={() => setSelectedSlot(s)}
                        className={"w-full text-left flex items-center gap-3 p-3 rounded-lg border mb-1 transition-colors " +
                          (isSelected ? "border-blue-400 bg-blue-50" : "border-gray-100 hover:border-gray-200")}>
                        <span className={"w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs " +
                          (isSelected ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300")}>
                          {isSelected ? "✓" : ""}
                        </span>
                        <div>
                          <p className="font-semibold text-sm">{(s as any).tours?.name}</p>
                          <p className="text-xs text-gray-400">{fmtTime(s.start_time)} · {s.booked} guests</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Photo URLs + Send */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="font-semibold mb-3">Photo URLs</h2>
            <p className="text-xs text-gray-400 mb-3">Upload photos to Google Drive, Dropbox, or any host and paste the share links here.</p>
            <div className="mb-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bulk import</p>
                <button type="button" onClick={importBulkUrls} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                  Import links
                </button>
              </div>
              <textarea
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder="Paste one image URL per line"
                rows={3}
                className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              {urls.map((u, i) => (
                <div key={i} className="flex items-start gap-2">
                  <input type="text" value={u} onChange={e => updateUrl(i, e.target.value)}
                    placeholder="https://drive.google.com/file/..."
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  {urls.length > 1 && (
                    <button onClick={() => removeUrl(i)} className="shrink-0 px-2 py-2 text-sm text-gray-400 hover:text-red-500">✕</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={addUrl} className="mt-2 text-sm text-blue-600 font-medium hover:text-blue-800">+ Add another photo</button>

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Preview gallery</span>
                <span>{validUrls.length} photo{validUrls.length === 1 ? "" : "s"} ready</span>
              </div>
              {validUrls.length === 0 ? (
                <div className="mt-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                  No photos added yet. Paste links to build the gallery preview.
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {validUrls.map((url, index) => (
                    <div key={url + index} className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                      <img src={url} alt={`Trip photo ${index + 1}`} loading="lazy" className="h-28 w-full object-cover" />
                      <div className="p-2">
                        <p className="truncate text-[11px] text-gray-500">{url}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button onClick={sendPhotos} disabled={sending || !selectedSlot || urls.every(u => !u.trim())}
            className="w-full bg-gray-900 text-white py-3 rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50">
            {sending ? "Sending..." : "📸 Send Photos & Thank You to " + (selectedSlot?.booked || 0) + " Guests"}
          </button>

          {sending && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-blue-700">
                <span>Sending photo batch</span>
                <span>{sendProgress}%</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-blue-100">
                <div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: `${sendProgress}%` }} />
              </div>
            </div>
          )}

          {result && (
            <div className={"text-sm p-3 rounded-lg " + (result.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
              {result.error ? "Error: " + result.error : "✅ Photos & thank-you email sent to " + result.sent + " guests!"}
            </div>
          )}
        </div>
      </div>

      {/* History */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Recently Sent</h2>
          <span className="text-xs text-gray-500">{sentHistory.length} items</span>
        </div>
        {sentHistory.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
            No photo batches have been sent yet.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sentHistory.map(p => (
              <a key={p.id} href={p.photo_url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 transition-colors hover:border-gray-300">
                <img src={p.photo_url} alt="Sent trip photo" loading="lazy" className="h-36 w-full object-cover" />
                <div className="space-y-1 p-3 text-sm">
                  <p className="truncate font-medium text-gray-900">{(p as any).slots?.tours?.name || "Trip photo"}</p>
                  <p className="text-xs text-gray-500">{(p as any).slots?.start_time ? fmtDate((p as any).slots.start_time) : "Unknown trip date"}</p>
                  <p className="truncate text-xs text-blue-600">{p.photo_url}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
