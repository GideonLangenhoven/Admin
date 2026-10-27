"use client";
import { pluralize } from "../../app/lib/automation-copy";
import { useEffect, useState, useRef } from "react";
import { confirmAction, notify } from "@/app/lib/app-notify";
import { getAdminTimezone } from "@/app/lib/admin-timezone";
import { supabase } from "@/app/lib/supabase";
import { uploadDriveMedia } from "@/app/lib/google-drive-upload";
import Link from "next/link";
import { getAuthHeaders } from "@/app/lib/admin-auth";
import { useBusinessContext } from "@/components/BusinessContext";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL!;

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

export default function TripPhotosWorkspace({ initialSlotId }: { initialSlotId?: string }) {
  const { businessId, role } = useBusinessContext();
  const isGuide = role === "GUIDE";
  const selectionVersion = useRef(0);
  const [slots, setSlots] = useState<SlotGroup[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
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

  useEffect(() => { loadSlots(); loadHistory(); checkGdrive(); }, [businessId, initialSlotId]);

  async function guideRequest(path: string, body?: unknown) {
    const response = await fetch(path, { method: body ? "POST" : "GET", headers: await getAuthHeaders(businessId), ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Trip photos could not be loaded.");
    return data;
  }

  async function selectTrip(slot: any) {
    const version = ++selectionVersion.current;
    setLoadingPhotos(true);
    setSelectedSlot(slot); setUrls([""]); setResult(null); setUploadedFolderUrl(""); setUploadFiles([]);
    try {
      const photos = isGuide
        ? (await guideRequest("/api/guide/photos?kind=history&slot_id=" + slot.id)).selected_photos
        : (await supabase.from("trip_photos").select("photo_url, gdrive_view_url").eq("business_id", businessId).eq("slot_id", slot.id)).data;
      if (version !== selectionVersion.current) return;
      const links = [...new Set<string>((photos || []).map((photo: any) => photo.gdrive_view_url || photo.photo_url).filter(Boolean))];
      setUrls(links.length ? links : [""]);
    } catch (error) { if (version === selectionVersion.current) setResult({ error: error instanceof Error ? error.message : "Photo links could not be loaded." }); }
    finally { if (version === selectionVersion.current) setLoadingPhotos(false); }
  }

  async function checkGdrive() {
    try {
      if (isGuide) { const data = await guideRequest("/api/guide/photos?kind=drive"); setGdriveConnected(data.connected); setGdriveEmail(data.email || ""); return; }
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
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (files.length > 0) setUploadFiles(prev => [...prev, ...files]);
    e.target.value = "";
  }

  function removeFile(i: number) { setUploadFiles(prev => prev.filter((_, idx) => idx !== i)); }

  async function uploadToDrive() {
    if (uploading || !selectedSlot || uploadFiles.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadedFolderUrl("");

    try {
      if (isGuide) {
        const folder = await guideRequest("/api/guide/photo-session", { action: "folder", slot_id: selectedSlot.id });
        const failed: File[] = [];
        let firstFailure = "";
        for (const [index, file] of uploadFiles.entries()) {
          try {
            const session = await guideRequest("/api/guide/photo-session", { action: "start", slot_id: selectedSlot.id, folder_token: folder.folder_token, file_name: file.name, content_type: file.type, size: file.size });
            if (new URL(session.upload_url).origin !== "https://www.googleapis.com" || !new URL(session.upload_url).pathname.startsWith("/upload/drive/")) throw new Error("Invalid upload session");
            const uploaded = await fetch(session.upload_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
            const result = await uploaded.json().catch(() => null);
            if (!uploaded.ok) throw new Error(typeof result?.error?.message === "string" ? result.error.message : "Google Drive could not accept the file. Please retry.");
            if (!result?.id) throw new Error("Upload unconfirmed. Check the Drive folder before retrying.");
          } catch (error) {
            failed.push(file);
            if (!firstFailure) firstFailure = error instanceof TypeError
              ? "Upload unconfirmed. Check your connection and Drive folder before retrying."
              : error instanceof Error ? error.message : "Google Drive upload failed. Please retry.";
          }
          setUploadProgress(Math.round(((index + 1) / uploadFiles.length) * 100));
        }
        const uploaded = uploadFiles.length - failed.length;
        setUploadFiles(failed);
        if (uploaded) {
          setUploadedFolderUrl(folder.folder_url);
          setUrls(previous => [...new Set([...previous.filter(url => url.trim()), folder.folder_url])]);
          await guideRequest("/api/guide/photo-session", { action: "complete", slot_id: selectedSlot.id, folder_token: folder.folder_token });
          loadHistory();
        }
        notify({ title: failed.length ? "Some uploads failed" : "Upload complete", message: uploaded + " of " + uploadFiles.length + " files uploaded." + (failed.length ? " " + firstFailure + " Failed files remain selected for retry." : ""), tone: failed.length ? "error" : "success" });
        return;
      }
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
      const failed: File[] = [];
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        try {
          await uploadDriveMedia(file, accessToken, folderId);
        } catch (error) {
          failed.push(file);
          console.error("Drive upload failed:", error);
        }

        setUploadProgress(Math.round(((i + 1) / uploadFiles.length) * 100));
      }

      const uploaded = uploadFiles.length - failed.length;
      setUploadFiles(failed);
      if (uploaded > 0) {
        setUploadedFolderUrl(folderUrl);
        // Keep earlier folders when retrying failed files.
        setUrls(previous => [...new Set([...previous.filter(url => url.trim()), folderUrl])]);
        const { error } = await supabase.from("trip_photos").insert({ slot_id: selectedSlot.id, photo_url: folderUrl, business_id: businessId });
        if (error) throw new Error(uploaded + " files uploaded. Link not saved; choose Send photos to save and share it.");
        loadHistory();
      }
      notify({
        title: failed.length ? "Some uploads failed" : "Upload complete",
        message: uploaded + " of " + uploadFiles.length + " files uploaded." + (failed.length ? " Failed files remain selected for retry." : ""),
        tone: failed.length ? "error" : "success",
      });
    } catch (e: any) {
      notify({ title: "Upload failed", message: e.message || "Unknown error", tone: "error" });
    }
    finally { setUploading(false); }
  }

  async function loadSlots() {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    if (isGuide) {
      try {
        const data = await guideRequest("/api/guide/photos?kind=slots" + (initialSlotId ? "&slot_id=" + initialSlotId : ""));
        groupSlots(data.slots);
        const selected = data.slots.find((slot: any) => slot.id === initialSlotId);
        if (selected) await selectTrip(selected);
      } catch (error) { setResult({ error: error instanceof Error ? error.message : "Trips could not be loaded." }); }
      return;
    }
    const { data } = await supabase.from("slots")
      .select("id, start_time, booked, tours(name)")
      .eq("business_id", businessId)
      .gt("booked", 0)
      .lt("start_time", now)
      .gt("start_time", past)
      .order("start_time", { ascending: false });
    groupSlots(data || []);
    if (initialSlotId) {
      let selected = data?.find(slot => slot.id === initialSlotId);
      if (!selected) {
        const result = await supabase.from("slots").select("id, start_time, booked, tours(name)").eq("business_id", businessId).eq("id", initialSlotId).maybeSingle();
        selected = result.data || undefined;
        if (selected) groupSlots([selected, ...(data || [])]);
      }
      if (selected) await selectTrip(selected);
    }
  }

  function groupSlots(data: any[]) {
    const groups: Record<string, SlotGroup> = {};
    for (const s of (data || [])) {
      const d = new Date(s.start_time).toISOString().split("T")[0];
      if (!groups[d]) groups[d] = { date: d, label: fmtDate(s.start_time), slots: [] };
      groups[d].slots.push(s);
    }
    setSlots(Object.values(groups));
  }

  async function loadHistory() {
    if (isGuide) {
      try { const data = await guideRequest("/api/guide/photos?kind=history"); setSentHistory(data.photos); }
      catch (error) { setResult({ error: error instanceof Error ? error.message : "Photo history could not be loaded." }); }
      return;
    }
    const { data } = await supabase.from("trip_photos")
      .select("id, photo_url, gdrive_view_url, uploaded_at, slots(start_time, tours(name))")
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
    if (sending) return;
    if (!selectedSlot) { notify({ title: "Select a trip", message: "Select a trip slot first.", tone: "warning" }); return; }
    const validUrls = [...new Set(urls.map(u => u.trim()).filter(Boolean))];
    if (validUrls.length === 0) { notify({ title: "No photo links", message: "Add at least one photo URL.", tone: "warning" }); return; }
    if (!await confirmAction({
      title: "Send photos",
      message: "Email photos and a thank-you to lead bookers? They'll be asked to share with their group.",
      tone: "info",
      confirmLabel: "Send now",
    })) return;

    setSending(true);
    setResult(null);
    setSendProgress(10);
    try {
      if (isGuide) {
        const data = await guideRequest("/api/guide/send-thank-you", { slot_id: selectedSlot.id, photo_urls: validUrls });
        setResult({ sent: data.sent, failures: data.failures });
        if (data.sent > 0 && data.failures.length === 0) { setUrls([""]); setSelectedSlot(null); }
        loadHistory(); return;
      }
      const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("Please sign in again before sending photos.");
      const tourName = (selectedSlot as any).tours?.name || "trip";

      // Fetch bookings for this slot
      const { data: bookings, error: bookingError } = await supabase.from("bookings")
        .select("id, customer_name, phone, email, status")
        .eq("business_id", businessId)
        .eq("slot_id", selectedSlot.id)
        .in("status", ["PAID", "CONFIRMED", "COMPLETED"]);
      if (bookingError) throw new Error("Guest list unavailable. Try again.");
      if (!bookings?.length) throw new Error("No confirmed customers were found for this trip.");

      // Save the links before notifying customers so they are also available in My Bookings.
      const { error: photoError } = await supabase.from("trip_photos").insert(validUrls.map(photo_url => ({
        slot_id: selectedSlot.id, photo_url, business_id: businessId,
      })));
      if (photoError) throw new Error("Could not save the photo links. No notifications were sent.");
      setSendProgress(35);

      let sent = 0;
      const failures: string[] = [];
      async function sendMessage(endpoint: string, body: unknown, label: string) {
        try {
          const response = await fetch(SU + "/functions/v1/" + endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
            body: JSON.stringify(body),
          });
          const outcome = await response.json();
          if (!response.ok || outcome.ok !== true) throw new Error(outcome.error || "Message was not sent");
          return true;
        } catch {
          failures.push(label);
          return false;
        }
      }
      for (const [index, b] of bookings.entries()) {
        let delivered = false;
        const name = b.customer_name || "Guest";
        // Include the links directly; a YES reply does not reliably identify this trip.
        if (b.phone) {
          const waMsg = "Hi " + (b.customer_name?.split(" ")[0] || "there") +
            "! 📸 Your trip photos from the " + tourName +
            " are ready!\n\n" + validUrls.join("\n") + "\n\nShare with your group and enjoy the memories!";
          delivered = await sendMessage("send-whatsapp-text", { business_id: businessId, booking_id: b.id, to: b.phone, message: waMsg }, name + " (WhatsApp)");
        }

        // Send thank-you email with photo link
        if (b.email) {
          const emailed = await sendMessage("send-email", {
            type: "TRIP_PHOTOS",
            data: { business_id: businessId, email: b.email, customer_name: name, tour_name: tourName, photo_url: validUrls[0], photo_urls: validUrls },
          }, name + " (email)");
          delivered = delivered || emailed;
        }
        if (!b.phone && !b.email) failures.push(name + " (no contact details)");
        if (delivered) sent++;
        setSendProgress(35 + Math.round(((index + 1) / bookings.length) * 45));
      }

      setSendProgress(100);

      setResult({ sent, failures });
      if (sent > 0 && failures.length === 0) { setUrls([""]); setSelectedSlot(null); }
      loadHistory();
    } catch (e) { setResult({ error: String(e) }); }
    finally { setSendProgress(0); setSending(false); }
  }

  return (
    <div className={isGuide ? "sv-page" : "max-w-4xl space-y-6"}>
      {isGuide && <Link href="/simpleguide" className="ui-btn ui-btn-soft min-h-11 self-start">Roll call</Link>}
      <div className={isGuide ? "sv-intro sv-intro--roll-call" : "anim-fade-up"}>
        {!isGuide && <p className="ui-mono-label mb-2">Operations</p>}
        <h1 className={isGuide ? "sv-title !mt-0" : "font-display text-[28px] font-semibold leading-none"} style={{ color: isGuide ? "var(--sv-pastel-text)" : "var(--ck-text-strong)" }}>Trip Photos</h1>
        {!isGuide && <p className="mt-2 text-sm" style={{ color: "var(--ck-text-muted)" }}>Choose a trip, add photos or links, then preview and send.</p>}
      </div>

      <div className="anim-fade-up anim-d1 grid gap-6 lg:grid-cols-2">
        {/* Left: Select Trip */}
        <div className="ui-card p-4">
          <h2 className="mb-3 text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Select Trip (Last 7 Days)</h2>
          {slots.length === 0 ? (
            <div className="ui-empty">              <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No recent trips</p>
              <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Booked trips from the last 7 days.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-auto">
              {slots.map(group => (
                <div key={group.date}>
                  <p className="ui-mono-label mb-1 !text-[10px]">{group.label}</p>
                  {group.slots.map(s => {
                    const isSelected = selectedSlot?.id === s.id;
                    return (
                      <button key={s.id} disabled={uploading || sending} onClick={() => selectTrip(s)}
                        className={"mb-1 flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all " +
                          (isSelected ? "border-[var(--ck-accent)] bg-[var(--ck-accent-soft)]" : "hover:border-[var(--ck-border-strong)]")}>
                        <span className={"flex h-5 w-5 items-center justify-center rounded-full text-xs " +
                          (isSelected ? "bg-[var(--ck-accent)] text-white" : "border-2 border-[var(--ck-border-strong)]")}>
                          {isSelected ? "✓" : ""}
                        </span>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{(s as any).tours?.name}</p>
                          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{fmtTime(s.start_time)} · {pluralize(s.booked, "guest")}</p>
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
                <input data-demo-action="photo.upload" ref={fileInputRef} type="file" multiple accept="image/*,video/*" disabled={uploading || sending || loadingPhotos} onChange={handleFileSelect} className="hidden" />
                <p className="text-sm font-medium" style={{ color: "var(--ck-text)" }}>
                  {dragOver ? "Drop files here" : "Drop photos or videos here, or browse."}
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
                        {f.type.startsWith("video/")
                          ? <video src={URL.createObjectURL(f)} muted playsInline className="h-20 w-full rounded-lg object-cover" style={{ border: "1px solid var(--ck-border-subtle)" }} />
                          : <img src={URL.createObjectURL(f)} alt={f.name} className="h-20 w-full rounded-lg object-cover" style={{ border: "1px solid var(--ck-border-subtle)" }} />}
                        <button onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                          className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          ✕
                        </button>
                        <p className="mt-0.5 truncate text-[10px]" style={{ color: "var(--ck-text-muted)" }}>{f.name}</p>
                      </div>
                    ))}
                  </div>
                  <button data-demo-action="photo.upload" onClick={uploadToDrive} disabled={uploading || sending || loadingPhotos || !selectedSlot}
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
                  <p className="mb-1 text-xs font-semibold" style={{ color: "var(--ck-success)" }}>Uploaded photo folder</p>
                  <a href={uploadedFolderUrl} target="_blank" rel="noreferrer" className="break-all text-xs underline" style={{ color: "var(--ck-ocean)" }}>{uploadedFolderUrl}</a>
                  <p className="mt-2 text-xs" style={{ color: "var(--ck-text-muted)" }}>Choose &quot;Send photos&quot; to email this link and a thank-you.</p>
                </div>
              )}
            </div>
          )}

          {/* Manual URL paste (always available) */}
          <div className="ui-card p-4">
            <h2 className="mb-3 text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{gdriveConnected ? "Photo Link" : "Photo URLs"}</h2>
            {!gdriveConnected && (
              <>
                <p className="mb-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>Paste share links from any host. For uploads, connect Google Drive in Settings.</p>
                <div className="mb-4 rounded-xl border border-dashed p-3" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface-sunken)" }}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="ui-mono-label !text-[10px]">Bulk import</p>
                    <button data-demo-action="photo.links" type="button" disabled={sending || loadingPhotos} onClick={importBulkUrls} className="ui-btn ui-btn-ghost !h-8 !px-3 !text-xs">
                      Import links
                    </button>
                  </div>
                  <textarea
                    value={bulkInput}
                    disabled={sending || loadingPhotos}
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
                  <input type="text" value={u} disabled={sending || loadingPhotos} onChange={e => updateUrl(i, e.target.value)}
                    placeholder="https://drive.google.com/drive/folders/..."
                    className="ui-control flex-1" />
                  {urls.length > 1 && (
                    <button disabled={sending || loadingPhotos} onClick={() => removeUrl(i)} className="shrink-0 px-2 py-2 text-sm transition-colors hover:text-[var(--ck-danger)]" style={{ color: "var(--ck-text-muted)" }}>✕</button>
                  )}
                </div>
              ))}
            </div>
            {!gdriveConnected && (
              <button disabled={sending || loadingPhotos} onClick={addUrl} className="mt-2 text-sm font-medium" style={{ color: "var(--ck-accent)" }}>Add link</button>
            )}
          </div>

          <div className={isGuide ? "ui-card p-3 space-y-3" : "space-y-3"}>
          {loadingPhotos && <p role="status" className="text-sm ui-text-muted">Loading photo links…</p>}
          <button data-demo-action="photo.send" onClick={sendPhotos} disabled={loadingPhotos || uploading || sending || !selectedSlot || urls.every(u => !u.trim())}
            className="ui-btn ui-btn-primary w-full min-h-11 !h-auto py-3 whitespace-normal disabled:opacity-50">
            {sending ? "Sending..." : "Send photos"}
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
            <div className="rounded-lg p-3 text-sm" style={result.error || result.failures?.length
              ? { background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }
              : { background: "var(--ck-success-soft)", color: "var(--ck-success)" }}>
              {result.error ? "Error: " + result.error : "Photos sent to " + result.sent + " lead booker" + (result.sent === 1 ? "" : "s") + "."}
              {result.failures?.length > 0 && <p className="mt-2">Messages failed: {result.failures.join(", ")}. Check these contacts before sending again.</p>}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* History */}
      <div className="ui-card anim-fade-up anim-d2 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Recent Photo Links</h2>
          <span className="ui-mono-label !text-[10px]"><span className="tabular-nums">{sentHistory.length}</span> items</span>
        </div>
        {sentHistory.length === 0 ? (
          <div className="ui-empty mt-3">            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Nothing sent yet</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>No photo batches sent yet.</p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sentHistory.map(p => {
              const url = String(p.gdrive_view_url || p.photo_url || "");
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
