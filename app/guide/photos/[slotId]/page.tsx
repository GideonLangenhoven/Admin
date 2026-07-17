"use client";

import { use, useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import { useBusinessContext } from "@/components/BusinessContext";

type Photo = { id: string; photo_url: string; gdrive_view_url: string | null; uploaded_at: string };

export default function GuidePhotosPage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = use(params);
  const { businessId } = useBusinessContext();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
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
        .maybeSingle(),
    ]);
    setPhotos((photosRes.data as Photo[]) || []);
    if (slotRes.data) setSlotInfo({ tour_name: (slotRes.data as any).tours?.name || "Tour", start_time: slotRes.data.start_time });
  }

  async function onPickPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setProgress({ done: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fd = new FormData();
      fd.append("file", file);
      fd.append("slot_id", slotId);
      try {
        const r = await fetch("/api/guide/photo-upload", { method: "POST", body: fd });
        if (!r.ok) console.warn("upload failed for", file.name, await r.text());
      } catch (e) { console.warn(e); }
      setProgress(prev => prev ? { ...prev, done: i + 1 } : null);
    }
    setUploading(false);
    setProgress(null);
    reload();
  }

  async function sendThankYou() {
    setEmailStatus("Sending...");
    try {
      const r = await fetch("/api/guide/send-thank-you", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot_id: slotId }),
      });
      const data = await r.json();
      if (r.ok) {
        setEmailStatus("Sent to " + data.recipient_count + " customer(s).");
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
            <span className="text-[12px] ui-text-muted">Saved to your Google Drive, shared as a private gallery in the thank-you email.</span>
          </>
        )}
        <input type="file" multiple accept="image/*" capture="environment" className="hidden"
          disabled={uploading} onChange={e => onPickPhotos(e.target.files)} />
      </label>

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
          style={{ color: emailStatus.startsWith("Sent") ? "var(--ck-success)" : emailStatus.startsWith("Sending") ? "var(--ck-text-muted)" : "var(--ck-danger)" }}>{emailStatus}</p>
      )}
    </div>
  );
}
