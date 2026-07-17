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

function isImageUrl(url: string) {
  return /\.(jpe?g|png|gif|webp|svg|avif)(\?|#|$)/i.test(url || "");
}

// Drive file URLs (https://drive.google.com/file/d/<id>/view) can be turned into
// a CORS-friendly thumbnail. Folder URLs (drive/folders/<id>) cannot be embedded
// directly — we render an icon for those instead of a broken <img>.
function driveFileThumb(url: string): string | null {
  const m = /drive\.google\.com\/file\/d\/([^/?#]+)/i.exec(url || "");
  return m ? "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w400" : null;
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
      const folderName = tripDate + " - " + tourName;

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
      <div className="anim-fade-up">
        <p className="ui-mono-label mb-2">Operations</p>
        <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Trip Photos</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ck-text-muted)" }}>Send trip photos and a thank-you email to guests. Select a recent trip, add a batch of links, and confirm the gallery preview before sending.</p>
      </div>

      <div className="anim-fade-up anim-d1 grid gap-6 lg:grid-cols-2">
        {/* Left: Select Trip */}
        <div className="ui-card p-4">
          <h2 className="mb-3 text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Select Trip (Last 7 Days)</h2>
          {slots.length === 0 ? (
            <div className="ui-empty">              <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No recent trips</p>
              <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Trips with bookings from the last 7 days show up here.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-auto">
              {slots.map(group => (
                <div key={group.date}>
                  <p className="ui-mono-label mb-1 !text-[10px]">{group.label}</p>
                  {group.slots.map(s => {
                    const isSelected = selectedSlot?.id === s.id;
                    return (
                      <button key={s.id} onClick={() => setSelectedSlot(s)}
                        className={"mb-1 flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all " +
                          (isSelected ? "border-[var(--ck-accent)] bg-[var(--ck-accent-soft)]" : "hover:border-[var(--ck-border-strong)]")}>
                        <span className={"flex h-5 w-5 items-center justify-center rounded-full text-xs " +
                          (isSelected ? "bg-[var(--ck-accent)] text-white" : "border-2 border-[var(--ck-border-strong)]")}>
                          {isSelected ? "✓" : ""}
                        </span>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{(s as any).tours?.name}</p>
                          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{fmtTime(s.start_time)} · {s.booked} guests</p>
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
            <div className="ui-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Upload to Google Drive</h2>
                <span className="ui-status ui-pill-success">{gdriveEmail}</span>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={"rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors " +
                  (dragOver ? "border-[var(--ck-accent)] bg-[var(--ck-accent-soft)]" : "border-[var(--ck-border-strong)] hover:border-[var(--ck-accent)]")}
                style={dragOver ? undefined : { background: "var(--ck-surface-sunken)" }}
              >
                <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" onChange={handleFileSelect} className="hidden" />
                <p className="text-sm font-medium" style={{ color: "var(--ck-text)" }}>
                  {dragOver ? "Drop files here" : "Drag & drop photos or click to browse"}
                </p>
                <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>Images and videos accepted</p>
              </div>

              {/* Selected files */}
              {uploadFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-xs" style={{ color: "var(--ck-text-muted)" }}>
                    <span className="tabular-nums">{uploadFiles.length} file{uploadFiles.length === 1 ? "" : "s"} selected</span>
                    <span className="tabular-nums">{(uploadFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-48 overflow-auto">
                    {uploadFiles.map((f, i) => (
                      <div key={f.name + i} className="relative group">
                        <img src={URL.createObjectURL(f)} alt={f.name} className="h-20 w-full rounded-lg object-cover" style={{ border: "1px solid var(--ck-border-subtle)" }} />
                        <button onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          ✕
                        </button>
                        <p className="mt-0.5 truncate text-[10px]" style={{ color: "var(--ck-text-muted)" }}>{f.name}</p>
                      </div>
                    ))}
                  </div>
                  <button onClick={uploadToDrive} disabled={uploading || !selectedSlot}
                    className="ui-btn ui-btn-primary w-full disabled:opacity-50">
                    {uploading ? "Uploading..." : !selectedSlot ? "Select a trip first" : "Upload to Google Drive"}
                  </button>
                </div>
              )}

              {/* Upload progress */}
              {uploading && (
                <div className="mt-3 rounded-xl p-3" style={{ background: "var(--ck-accent-soft)" }}>
                  <div className="flex items-center justify-between text-xs font-semibold" style={{ color: "var(--ck-accent)" }}>
                    <span>Uploading to Drive</span>
                    <span className="tabular-nums">{uploadProgress}%</span>
                  </div>
                  <div className="ui-progress mt-2">
                    <div className="ui-progress-fill" style={{ width: uploadProgress + "%" }} />
                  </div>
                </div>
              )}

              {/* Folder link result */}
              {uploadedFolderUrl && (
                <div className="mt-3 rounded-xl p-3" style={{ background: "var(--ck-success-soft)", border: "1px solid color-mix(in srgb, var(--ck-success) 25%, transparent)" }}>
                  <p className="mb-1 text-xs font-semibold" style={{ color: "var(--ck-success)" }}>Photos uploaded successfully</p>
                  <a href={uploadedFolderUrl} target="_blank" rel="noreferrer" className="break-all text-xs underline" style={{ color: "var(--ck-ocean)" }}>{uploadedFolderUrl}</a>
                  <p className="mt-2 text-xs" style={{ color: "var(--ck-text-muted)" }}>Click &quot;Send Photos&quot; below to share this link with customers.</p>
                </div>
              )}
            </div>
          )}

          {/* Manual URL paste (always available) */}
          <div className="ui-card p-4">
            <h2 className="mb-3 text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{gdriveConnected ? "Photo Link" : "Photo URLs"}</h2>
            {!gdriveConnected && (
              <>
                <p className="mb-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>Paste share links from Google Drive, Dropbox, or any host. Connect Google Drive in Settings for direct uploads.</p>
                <div className="mb-4 rounded-xl border border-dashed p-3" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface-sunken)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="ui-mono-label !text-[10px]">Bulk import</p>
                    <button type="button" onClick={importBulkUrls} className="ui-btn ui-btn-ghost !h-8 !px-3 !text-xs">
                      Import links
                    </button>
                  </div>
                  <textarea
                    value={bulkInput}
                    onChange={(e) => setBulkInput(e.target.value)}
                    placeholder="Paste one image URL per line"
                    rows={3}
                    className="ui-control mt-2 w-full"
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              {urls.map((u, i) => (
                <div key={i} className="flex items-start gap-2">
                  <input type="text" value={u} onChange={e => updateUrl(i, e.target.value)}
                    placeholder="https://drive.google.com/drive/folders/..."
                    className="ui-control flex-1" />
                  {urls.length > 1 && (
                    <button onClick={() => removeUrl(i)} className="shrink-0 px-2 py-2 text-sm transition-colors hover:text-[var(--ck-danger)]" style={{ color: "var(--ck-text-muted)" }}>✕</button>
                  )}
                </div>
              ))}
            </div>
            {!gdriveConnected && (
              <button onClick={addUrl} className="mt-2 text-sm font-medium" style={{ color: "var(--ck-accent)" }}>+ Add another link</button>
            )}
          </div>

          <button onClick={sendPhotos} disabled={sending || !selectedSlot || urls.every(u => !u.trim())}
            className="ui-btn ui-btn-primary w-full !h-11 disabled:opacity-50">
            {sending ? "Sending..." : "Send Photos to Lead Bookers"}
          </button>

          {sending && (
            <div className="rounded-xl p-3" style={{ background: "var(--ck-accent-soft)" }}>
              <div className="flex items-center justify-between text-xs font-semibold" style={{ color: "var(--ck-accent)" }}>
                <span>Sending photo batch</span>
                <span className="tabular-nums">{sendProgress}%</span>
              </div>
              <div className="ui-progress mt-2">
                <div className="ui-progress-fill" style={{ width: `${sendProgress}%` }} />
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-lg p-3 text-sm" style={result.error
              ? { background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }
              : { background: "var(--ck-success-soft)", color: "var(--ck-success)" }}>
              {result.error ? "Error: " + result.error : "Photos sent to " + result.sent + " lead booker" + (result.sent === 1 ? "" : "s") + "! They've been asked to share with their group."}
            </div>
          )}
        </div>
      </div>

      {/* History */}
      <div className="ui-card anim-fade-up anim-d2 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Recently Sent</h2>
          <span className="ui-mono-label !text-[10px]"><span className="tabular-nums">{sentHistory.length}</span> items</span>
        </div>
        {sentHistory.length === 0 ? (
          <div className="ui-empty mt-3">            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Nothing sent yet</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Photo batches you send to guests will appear here.</p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sentHistory.map(p => {
              const url = String(p.photo_url || "");
              const tripStart = (p as any).slots?.start_time as string | undefined;
              const dateLabel = tripStart
                ? fmtDate(tripStart)
                : p.uploaded_at
                  ? "Sent " + fmtDate(p.uploaded_at)
                  : "Date unavailable";
              const driveThumb = driveFileThumb(url);
              const showImg = isImageUrl(url) || Boolean(driveThumb);
              return (
                <a key={p.id} href={url} target="_blank" rel="noreferrer" className="ui-card ui-card-hover block overflow-hidden !rounded-xl">
                  {showImg ? (
                    <img src={driveThumb || url} alt="Sent trip photo" loading="lazy" referrerPolicy="no-referrer" className="h-36 w-full object-cover" />
                  ) : (
                    <div className="flex h-36 w-full items-center justify-center" style={{ background: "var(--ck-ocean-soft)", color: "var(--ck-ocean)" }}>
                      <svg viewBox="0 0 24 24" className="h-12 w-12" fill="currentColor" aria-hidden="true">
                        <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
                      </svg>
                    </div>
                  )}
                  <div className="space-y-1 p-3 text-sm">
                    <p className="truncate font-medium" style={{ color: "var(--ck-text-strong)" }}>{(p as any).slots?.tours?.name || "Trip photo"}</p>
                    <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{dateLabel}</p>
                    <p className="truncate text-xs" style={{ color: "var(--ck-ocean)" }}>{url}</p>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
