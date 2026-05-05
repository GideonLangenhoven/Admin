"use client";
import { useEffect, useState, useRef } from "react";
import { confirmAction, notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: getAdminTimezone() });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
}

type SlotGroup = { date: string; label: string; slots: any[] };

export default function PhotosPage() {
  const { businessId } = useBusinessContext();
  const [bookingSiteUrl, setBookingSiteUrl] = useState("");
  const [slots, setSlots] = useState<SlotGroup[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [urls, setUrls] = useState<string[]>([""]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [sentHistory, setSentHistory] = useState<any[]>([]);
  const [bulkInput, setBulkInput] = useState("");
  const [sendProgress, setSendProgress] = useState(0);

  // Google Drive upload state
  const [gdriveConnected, setGdriveConnected] = useState(false);
  const [gdriveEmail, setGdriveEmail] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedFolderUrl, setUploadedFolderUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadSlots(); loadHistory(); loadBusinessLinks(); checkGdrive(); }, [businessId]);

  async function checkGdrive() {
    try {
      const { data } = await supabase.functions.invoke("google-drive", {
        body: { action: "status", business_id: businessId },
      });
      if (data && !data.error) {
        setGdriveConnected(data.connected);
        setGdriveEmail(data.email || "");
      }
    } catch (_) { /* ignore */ }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (files.length > 0) setUploadFiles(prev => [...prev, ...files]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) setUploadFiles(prev => [...prev, ...files]);
    e.target.value = "";
  }

  function removeFile(i: number) { setUploadFiles(prev => prev.filter((_, idx) => idx !== i)); }

  async function uploadToDrive() {
    if (!selectedSlot || uploadFiles.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadedFolderUrl("");

    try {
      // Create a trip subfolder
      const tourName = (selectedSlot as any).tours?.name || "Trip";
      const tripDate = fmtDate(selectedSlot.start_time);
      const folderName = tripDate + " — " + tourName;

      const { data: folderData, error: folderErr } = await supabase.functions.invoke("google-drive", {
        body: { action: "create_folder", business_id: businessId, folder_name: folderName },
      });
      if (folderErr || folderData?.error) {
        notify({ title: "Upload failed", message: folderData?.error || folderErr?.message || "Could not create Drive folder.", tone: "error" });
        setUploading(false);
        return;
      }

      const folderId = folderData.folder_id;
      const folderUrl = folderData.folder_url;

      // Get a fresh access token for direct browser-to-Google uploads
      const { data: tokenData, error: tokenErr } = await supabase.functions.invoke("google-drive", {
        body: { action: "token", business_id: businessId },
      });
      if (tokenErr || tokenData?.error) {
        notify({ title: "Upload failed", message: tokenData?.error || "Could not get access token. Reconnect Google Drive in Settings.", tone: "error" });
        setUploading(false);
        return;
      }

      const accessToken = tokenData.access_token;

      // Upload each file directly to Google Drive
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        const metadata = JSON.stringify({ name: file.name, parents: [folderId] });
        const form = new FormData();
        form.append("metadata", new Blob([metadata], { type: "application/json" }));
        form.append("file", file);

        const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
          method: "POST",
          headers: { Authorization: "Bearer " + accessToken },
          body: form,
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.error("Drive upload failed for", file.name, errBody);
        }

        setUploadProgress(Math.round(((i + 1) / uploadFiles.length) * 100));
      }

      setUploadedFolderUrl(folderUrl);
      setUrls([folderUrl]);

      // Log to trip_photos
      await supabase.from("trip_photos").insert({ slot_id: selectedSlot.id, photo_url: folderUrl, business_id: businessId });

      notify({ title: "Upload complete", message: uploadFiles.length + " file" + (uploadFiles.length === 1 ? "" : "s") + " uploaded to Google Drive.", tone: "success" });
      setUploadFiles([]);
      loadHistory();
    } catch (e: any) {
      notify({ title: "Upload failed", message: e.message || "Unknown error", tone: "error" });
    }
    setUploading(false);
  }

  async function loadBusinessLinks() {
    const { data } = await supabase.from("businesses").select("booking_site_url").eq("id", businessId).maybeSingle();
    setBookingSiteUrl(data?.booking_site_url || "");
  }

  async function loadSlots() {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const { data } = await supabase.from("slots")
      .select("id, start_time, booked, tours(name)")
      .eq("business_id", businessId)
      .gt("booked", 0)
      .lt("start_time", now)
      .gt("start_time", past)
      .order("start_time", { ascending: false });
    const groups: Record<string, SlotGroup> = {};
    for (const s of (data || [])) {
      const d = new Date(s.start_time).toISOString().split("T")[0];
      if (!groups[d]) groups[d] = { date: d, label: fmtDate(s.start_time), slots: [] };
      groups[d].slots.push(s);
    }
    setSlots(Object.values(groups));
  }

  async function loadHistory() {
    const { data } = await supabase.from("trip_photos")
      .select("id, photo_url, uploaded_at, slots(start_time, tours(name))")
      .eq("business_id", businessId)
      .order("uploaded_at", { ascending: false })
      .limit(20);
    setSentHistory(data || []);
  }

  function addUrl() { setUrls([...urls, ""]); }
  function removeUrl(i: number) { setUrls(urls.filter((_, idx) => idx !== i)); }
  function updateUrl(i: number, v: string) { const n = [...urls]; n[i] = v; setUrls(n); }
  function importBulkUrls() {
    const next = bulkInput
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (next.length === 0) return;
    setUrls(next);
    setBulkInput("");
  }

  async function sendPhotos() {
    if (!selectedSlot) { notify({ title: "Select a trip", message: "Select a trip slot first.", tone: "warning" }); return; }
    const validUrls = urls.filter(u => u.trim().length > 0);
    if (validUrls.length === 0) { notify({ title: "No photo links", message: "Add at least one photo URL.", tone: "warning" }); return; }
    if (!await confirmAction({
      title: "Send trip photos",
      message: "Send photos and a thank-you email to lead bookers on this trip? They'll be asked to share the link with their group.",
      tone: "info",
      confirmLabel: "Send photos",
    })) return;

    setSending(true);
    setResult(null);
    setSendProgress(10);
    try {
      const tourName = (selectedSlot as any).tours?.name || "kayak trip";
      const photoLink = validUrls.length === 1 ? validUrls[0] : validUrls[0];

      // Fetch bookings for this slot
      const { data: bookings } = await supabase.from("bookings")
        .select("id, customer_name, phone, email, status")
        .eq("business_id", businessId)
        .eq("slot_id", selectedSlot.id)
        .in("status", ["PAID", "CONFIRMED", "COMPLETED"]);
      setSendProgress(35);

      let sent = 0;
      for (const b of (bookings || [])) {
        // Send WhatsApp photo notification via template (24h compliant).
        // Uses send-whatsapp-text which has built-in template fallback for
        // customers outside the 24h window. The message is kept short and
        // asks the customer to reply YES to receive the photo link,
        // ensuring we open a new 24h window for follow-up.
        if (b.phone) {
          const waMsg = "Hi " + (b.customer_name?.split(" ")[0] || "there") +
            "! 📸 Your trip photos from the " + tourName +
            " are ready! Reply YES to this message to receive the photo link." +
            "\n\nShare with your group once you get it!";
          try {
            await fetch(SU + "/functions/v1/send-whatsapp-text", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
              body: JSON.stringify({ business_id: businessId, to: b.phone, message: waMsg }),
            });
          } catch (e) { console.error("WA photo send failed:", b.phone, e); }
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
          } catch (e) { console.error("Email photo send failed:", b.email, e); }
        }
        sent++;
        setSendProgress(35 + Math.round((sent / Math.max((bookings || []).length, 1)) * 45));
      }

      // Log to trip_photos
      for (const url of validUrls) {
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

  const validUrls = urls.filter(u => u.trim().length > 0);

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Trip Photos</h1>
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
                    const isSelected = selectedSlot?.id === s.id;
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

        {/* Right: Upload / Photo URLs + Send */}
        <div className="space-y-4">
          {/* Google Drive Upload */}
          {gdriveConnected && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Upload to Google Drive</h2>
                <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">{gdriveEmail}</span>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={"rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors " +
                  (dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-gray-50 hover:border-gray-400")}
              >
                <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" onChange={handleFileSelect} className="hidden" />
                <p className="text-sm font-medium text-gray-600">
                  {dragOver ? "Drop files here" : "Drag & drop photos or click to browse"}
                </p>
                <p className="text-xs text-gray-400 mt-1">Images and videos accepted</p>
              </div>

              {/* Selected files */}
              {uploadFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{uploadFiles.length} file{uploadFiles.length === 1 ? "" : "s"} selected</span>
                    <span>{(uploadFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-48 overflow-auto">
                    {uploadFiles.map((f, i) => (
                      <div key={f.name + i} className="relative group">
                        <img src={URL.createObjectURL(f)} alt={f.name} className="h-20 w-full object-cover rounded-lg border border-gray-200" />
                        <button onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          ✕
                        </button>
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">{f.name}</p>
                      </div>
                    ))}
                  </div>
                  <button onClick={uploadToDrive} disabled={uploading || !selectedSlot}
                    className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                    {uploading ? "Uploading..." : !selectedSlot ? "Select a trip first" : "Upload to Google Drive"}
                  </button>
                </div>
              )}

              {/* Upload progress */}
              {uploading && (
                <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-blue-700">
                    <span>Uploading to Drive</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-blue-100">
                    <div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: uploadProgress + "%" }} />
                  </div>
                </div>
              )}

              {/* Folder link result */}
              {uploadedFolderUrl && (
                <div className="mt-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50">
                  <p className="text-xs font-semibold text-emerald-800 mb-1">Photos uploaded successfully</p>
                  <a href={uploadedFolderUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline break-all">{uploadedFolderUrl}</a>
                  <p className="text-xs text-emerald-600 mt-2">Click &quot;Send Photos&quot; below to share this link with customers.</p>
                </div>
              )}
            </div>
          )}

          {/* Manual URL paste (always available) */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="font-semibold mb-3">{gdriveConnected ? "Photo Link" : "Photo URLs"}</h2>
            {!gdriveConnected && (
              <>
                <p className="text-xs text-gray-400 mb-3">Paste share links from Google Drive, Dropbox, or any host. Connect Google Drive in Settings for direct uploads.</p>
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
              </>
            )}
            <div className="space-y-2">
              {urls.map((u, i) => (
                <div key={i} className="flex items-start gap-2">
                  <input type="text" value={u} onChange={e => updateUrl(i, e.target.value)}
                    placeholder="https://drive.google.com/drive/folders/..."
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  {urls.length > 1 && (
                    <button onClick={() => removeUrl(i)} className="shrink-0 px-2 py-2 text-sm text-gray-400 hover:text-red-500">✕</button>
                  )}
                </div>
              ))}
            </div>
            {!gdriveConnected && (
              <button onClick={addUrl} className="mt-2 text-sm text-blue-600 font-medium hover:text-blue-800">+ Add another link</button>
            )}
          </div>

          <button onClick={sendPhotos} disabled={sending || !selectedSlot || urls.every(u => !u.trim())}
            className="w-full bg-gray-900 text-white py-3 rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50">
            {sending ? "Sending..." : "Send Photos to Lead Bookers"}
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
              {result.error ? "Error: " + result.error : "Photos sent to " + result.sent + " lead booker" + (result.sent === 1 ? "" : "s") + "! They've been asked to share with their group."}
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
