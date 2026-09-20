"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import { getAuthHeaders } from "@/app/lib/admin-auth";
import { useBusinessContext } from "@/components/BusinessContext";

type Photo = { id: string; photo_url: string; gdrive_view_url: string | null; uploaded_at: string };

export default function GuidePhotosPage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = use(params);
  const { businessId } = useBusinessContext();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [slotInfo, setSlotInfo] = useState<{ tour_name: string; start_time: string } | null>(null);

  useEffect(() => { reload(); }, [slotId, businessId]);

  async function reload() {
    if (!businessId) return;
    const [photosRes, slotRes] = await Promise.all([
      supabase.from("trip_photos")
        .select("id, photo_url, gdrive_view_url, uploaded_at")
        .eq("slot_id", slotId)
        .eq("business_id", businessId)
        .order("uploaded_at", { ascending: false }),
      supabase.from("slots")
        .select("start_time, tours(name)")
        .eq("id", slotId)
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);
    setPhotos((photosRes.data as Photo[]) || []);
    if (slotRes.data) setSlotInfo({ tour_name: (slotRes.data as any).tours?.name || "Tour", start_time: slotRes.data.start_time });
  }

  async function onPickPhotos(files: FileList | null) {
    if (uploading || !files || files.length === 0) return;
    setUploading(true);
    setUploadStatus(null);
    setProgress({ done: 0, total: files.length });

    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) throw new Error("Please sign in again before uploading photos.");
      delete headers["Content-Type"]; // The browser supplies the multipart boundary.
      const failed: string[] = [];
      const needsReview: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fd = new FormData();
        fd.append("file", file);
        fd.append("slot_id", slotId);
        try {
          const r = await fetch("/api/guide/photo-upload", { method: "POST", headers, body: fd });
          const data = await r.json();
          if (!r.ok || data.ok !== true) {
            const uploadError = new Error(data.error || "Upload failed") as Error & { retryable?: boolean };
            uploadError.retryable = data.retryable !== false;
            throw uploadError;
          }
        } catch (error) {
          if (error instanceof Error && "retryable" in error && error.retryable === false) needsReview.push(file.name);
          else if (error instanceof Error && "retryable" in error) failed.push(file.name);
          else needsReview.push(file.name);
        }
        setProgress(prev => prev ? { ...prev, done: i + 1 } : null);
      }
      const confirmed = files.length - failed.length - needsReview.length;
      setUploadStatus(confirmed + " of " + files.length + " photos uploaded."
        + (failed.length ? " Please retry: " + failed.join(", ") + (needsReview.length ? "." : "") : "")
        + (needsReview.length ? " Check the gallery before retrying: " + needsReview.join(", ") + "." : ""));
      reload();
    } catch (e: any) {
      setUploadStatus(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function sendThankYou() {
    setEmailStatus("Sending...");
    try {
      const headers = await getAuthHeaders();
      if (!headers.Authorization) throw new Error("Please sign in again before sending photos.");
      const r = await fetch("/api/guide/send-thank-you", {
        method: "POST",
        headers,
        body: JSON.stringify({ slot_id: slotId }),
      });
      const data = await r.json();
      if (r.ok && typeof data.recipient_count === "number") {
        setEmailStatus(data.failed?.length
          ? "Sent to " + data.recipient_count + " customer(s); " + data.failed.length + " failed. Check customer contact details before sending again."
          : "Sent to " + data.recipient_count + " customer(s).");
      } else {
        setEmailStatus("Failed: " + (data.error || "unknown"));
      }
    } catch (e: any) {
      setEmailStatus("Failed: " + (e?.message || "network error"));
    }
  }

  return (
    <div className="pt-5">
      <div className="mb-4">
        <h2 className="font-display text-[24px] font-semibold leading-tight" style={{ color: "var(--ck-text-strong)" }}>Trip photos</h2>
        {slotInfo && <p className="text-[13px] font-medium ui-text-muted">{slotInfo.tour_name} · {new Date(slotInfo.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>}
      </div>

      <label className="flex flex-col items-center justify-center gap-2 p-6 rounded-2xl text-center cursor-pointer transition border-2 border-dashed active:scale-[0.99]"
        style={uploading
          ? { borderColor: "var(--ck-accent)", background: "var(--ck-accent-soft)" }
          : { borderColor: "var(--ck-border-strong)", background: "var(--ck-surface)" }}>
        {uploading ? (
          <>
            <div className="w-10 h-10 rounded-full border-[3px] animate-spin" style={{ borderColor: "var(--ck-accent-soft)", borderTopColor: "var(--ck-accent)" }} />
            <span className="text-[14px] font-semibold" style={{ color: "var(--ck-accent)" }}>Uploading {progress?.done || 0}/{progress?.total || 0}…</span>
          </>
        ) : (
          <>
            <span className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Take or pick photos</span>
            <span className="text-[12px] ui-text-muted">JPEG, PNG, WebP, AVIF, or still GIF up to 4 MB. Saved to your Google Drive.</span>
          </>
        )}
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,image/gif" capture="environment" className="hidden"
          disabled={uploading} onChange={async e => { const input = e.currentTarget; await onPickPhotos(input.files); input.value = ""; }} />
      </label>
      {uploadStatus && <p role="status" className="mt-3 text-[13px] font-semibold">{uploadStatus}</p>}

      {photos.length > 0 && (
        <>
          <h3 className="ui-section-title mt-6 mb-2">Uploaded · {photos.length}</h3>
          <div className="grid grid-cols-3 gap-2">
            {photos.map(p => (
              <a key={p.id} href={p.gdrive_view_url || p.photo_url} target="_blank" rel="noreferrer"
                className="block aspect-square rounded-xl overflow-hidden border active:scale-95 transition"
                style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface-sunken)" }}>
                <img src={p.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
              </a>
            ))}
          </div>

          <button onClick={sendThankYou} disabled={!!emailStatus?.startsWith("Sending")}
            className="mt-6 w-full flex items-center justify-center gap-2 p-4 rounded-2xl text-white font-semibold active:scale-[0.99] transition disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #D9822F, #B4641C)", boxShadow: "var(--ck-shadow-sm)" }}>
            Send thank-you email with photos
          </button>
        </>
      )}
      {emailStatus && (
        <p className="mt-3 text-[13px] font-semibold text-center"
          style={{ color: emailStatus.startsWith("Sent") && !emailStatus.includes("failed") ? "var(--ck-success)" : emailStatus.startsWith("Sending") ? "var(--ck-text-muted)" : "var(--ck-danger)" }}>{emailStatus}</p>
      )}
    </div>
  );
}
