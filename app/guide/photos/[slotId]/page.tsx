"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
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
    <div className="max-w-md mx-auto p-4 pb-20">
      <header className="flex items-center justify-between mb-4">
        <Link href={"/guide/slot/" + slotId} className="text-sm text-[color:var(--accent)] font-medium">&larr; Back to check-in</Link>
        {slotInfo && (
          <div className="text-right">
            <p className="text-sm font-bold text-[color:var(--text)]">{slotInfo.tour_name}</p>
            <p className="text-xs text-[color:var(--textMuted)]">{new Date(slotInfo.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        )}
      </header>

      <h1 className="text-xl font-bold text-[color:var(--text)] mb-4">Trip Photos</h1>

      <label className={"block p-4 rounded-xl text-center font-semibold cursor-pointer transition-colors " + (uploading ? "bg-emerald-400 text-white" : "bg-emerald-600 text-white active:bg-emerald-700")}>
        {uploading ? ("Uploading " + (progress?.done || 0) + "/" + (progress?.total || 0) + "...") : "Pick / take photos"}
        <input type="file" multiple accept="image/*" capture="environment" className="hidden"
          disabled={uploading} onChange={e => onPickPhotos(e.target.files)} />
      </label>

      {photos.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold text-[color:var(--text)]">Uploaded ({photos.length})</h2>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photos.map(p => (
                <a key={p.id} href={p.gdrive_view_url || p.photo_url} target="_blank" rel="noreferrer"
                  className="block aspect-square rounded-lg bg-[color:var(--surface2)] overflow-hidden border border-[color:var(--border)]">
                  <img src={p.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </a>
            ))}
          </div>
        </>
      )}

      {photos.length > 0 && (
        <button onClick={sendThankYou} disabled={!!emailStatus?.startsWith("Sending")}
          className="mt-6 w-full p-4 rounded-xl bg-amber-500 text-white font-bold active:bg-amber-600 transition-colors disabled:opacity-60">
          Send thank-you email with photos
        </button>
      )}
      {emailStatus && (
        <p className={"mt-2 text-sm text-center " + (emailStatus.startsWith("Sent") ? "text-emerald-600" : emailStatus.startsWith("Sending") ? "text-[color:var(--textMuted)]" : "text-red-500")}>{emailStatus}</p>
      )}
    </div>
  );
}
