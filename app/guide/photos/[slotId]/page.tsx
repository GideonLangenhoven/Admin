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
        <h2 className="text-[22px] font-extrabold text-slate-900 leading-tight">Trip photos</h2>
        {slotInfo && <p className="text-[13px] text-slate-500 font-medium">{slotInfo.tour_name} · {new Date(slotInfo.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>}
      </div>

      <label className={"flex flex-col items-center justify-center gap-2 p-6 rounded-2xl text-center cursor-pointer transition border-2 border-dashed " + (uploading ? "border-cyan-300 bg-cyan-50" : "border-slate-200 bg-white hover:border-cyan-300 active:scale-[0.99]")}>
        {uploading ? (
          <>
            <div className="w-10 h-10 rounded-full border-[3px] border-cyan-200 border-t-cyan-600 animate-spin" />
            <span className="text-[14px] font-bold text-cyan-700">Uploading {progress?.done || 0}/{progress?.total || 0}…</span>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-cyan-100 text-cyan-600 flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 019.07 4h5.86a2 2 0 011.664.89l.812 1.22A2 2 0 0019.07 7H20a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            <span className="text-[15px] font-bold text-slate-800">Take or pick photos</span>
            <span className="text-[12px] text-slate-400">Saved to your Google Drive, shared as a private gallery in the thank-you email.</span>
          </>
        )}
        <input type="file" multiple accept="image/*" capture="environment" className="hidden"
          disabled={uploading} onChange={e => onPickPhotos(e.target.files)} />
      </label>

      {photos.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Uploaded · {photos.length}</h3>
          <div className="grid grid-cols-3 gap-2">
            {photos.map(p => (
              <a key={p.id} href={p.gdrive_view_url || p.photo_url} target="_blank" rel="noreferrer"
                className="block aspect-square rounded-xl overflow-hidden border border-slate-100 bg-slate-100 active:scale-95 transition">
                <img src={p.photo_url} alt="" className="w-full h-full object-cover" loading="lazy" />
              </a>
            ))}
          </div>

          <button onClick={sendThankYou} disabled={!!emailStatus?.startsWith("Sending")}
            className="mt-6 w-full flex items-center justify-center gap-2 p-4 rounded-2xl text-white font-bold shadow-sm active:scale-[0.99] transition disabled:opacity-60"
            style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Send thank-you email with photos
          </button>
        </>
      )}
      {emailStatus && (
        <p className={"mt-3 text-[13px] font-semibold text-center " + (emailStatus.startsWith("Sent") ? "text-emerald-600" : emailStatus.startsWith("Sending") ? "text-slate-400" : "text-rose-500")}>{emailStatus}</p>
      )}
    </div>
  );
}
