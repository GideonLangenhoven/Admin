"use client";

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../app/lib/supabase";
import { notify, confirmAction } from "../app/lib/app-notify";
import { Trash, PencilSimple } from "@phosphor-icons/react";

interface SlotItem {
  id: string;
  start_time: string;
  capacity_total: number;
  booked: number;
  held: number;
  status: string;
}

export default function InlineSlotManager({
  tourId,
  businessId,
}: {
  tourId: string;
  businessId: string;
}) {
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit bundle capacity
  const [editingBundleTime, setEditingBundleTime] = useState<string | null>(null);
  const [editCap, setEditCap] = useState(10);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    loadSlots();
  }, [tourId, businessId]);

  async function loadSlots() {
    setLoading(true);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("slots")
      .select("id, start_time, capacity_total, booked, held, status")
      .eq("business_id", businessId)
      .eq("tour_id", tourId)
      .gte("start_time", startOfToday.toISOString());

    if (error) {
      notify({ tone: "error", title: "Error loading slots", message: error.message });
    } else {
      setSlots(data || []);
    }
    setLoading(false);
  }

  async function handleBundleDelete(timeKey: string, items: SlotItem[]) {
    // Only delete items that don't have bookings or holds
    const safeToDeleteIds = items.filter(s => s.booked === 0 && s.held === 0).map(s => s.id);

    if (safeToDeleteIds.length === 0) {
      notify({
        tone: "warning",
        title: "Cannot delete",
        message: "All upcoming slots for this time have active bookings or holds."
      });
      return;
    }

    const message = safeToDeleteIds.length === items.length
      ? `Are you sure you want to delete all ${items.length} upcoming slots at ${timeKey}?`
      : `Delete ${safeToDeleteIds.length} open slots at ${timeKey}? The remaining ${items.length - safeToDeleteIds.length} slots possess active bookings and won't be deleted.`;

    if (!await confirmAction({
      title: `Delete ${timeKey} Slots`,
      message: message,
      tone: "warning",
      confirmLabel: "Delete"
    })) return;

    let successCount = 0;
    // Chunk array since Supabase REST has URI limits, usually 100-200 is fine, but chunking 50 is safer.
    for (let i = 0; i < safeToDeleteIds.length; i += 50) {
      const chunk = safeToDeleteIds.slice(i, i + 50);
      const { error } = await supabase.from("slots").delete().in("id", chunk);
      if (!error) successCount += chunk.length;
    }

    notify({ tone: "success", title: "Slots deleted", message: `${successCount} slots at ${timeKey} were permanently removed.` });
    loadSlots();
  }

  async function handleBundleEdit(e: React.FormEvent, timeKey: string, items: SlotItem[]) {
    e.preventDefault();
    if (editCap <= 0) return;

    setSavingEdit(true);

    const allIds = items.map(s => s.id);
    let successCount = 0;
    for (let i = 0; i < allIds.length; i += 50) {
      const chunk = allIds.slice(i, i + 50);
      const { error } = await supabase.from("slots").update({ capacity_total: editCap }).in("id", chunk);
      if (!error) successCount += chunk.length;
    }

    setSavingEdit(false);
    setEditingBundleTime(null);
    notify({ tone: "success", title: "Capacity updated", message: `Updated capacity to ${editCap} for ${successCount} slots.` });
    
    // Optimistic UI update
    setSlots(curr => curr.map(s => allIds.includes(s.id) ? { ...s, capacity_total: editCap } : s));
  }

  // Bundle slots by local Time (SAST)
  const bundled = useMemo(() => {
    const map = new Map<string, SlotItem[]>();
    for (const slot of slots) {
      const sastTime = new Date(new Date(slot.start_time).getTime() + 2 * 60 * 60 * 1000);
      // Generate a clean 12-hour AM/PM string, e.g. "08:00 AM"
      const timeKey = sastTime.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: true });
      if (!map.has(timeKey)) map.set(timeKey, []);
      map.get(timeKey)!.push(slot);
    }
    
    // Sort array chronologically by creating a dummy date
    return Array.from(map.entries()).sort((a, b) => {
      const timeA = new Date(`1970/01/01 ${a[0]}`).getTime();
      const timeB = new Date(`1970/01/01 ${b[0]}`).getTime();
      return timeA - timeB;
    });
  }, [slots]);

  return (
    <div className="mt-4 border-t border-[var(--ck-border-subtle)] pt-4">
      <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-2">Manage Schedule Times</h3>
      <p className="text-xs text-[var(--ck-text-muted)] mb-4">View, edit, or delete all future upcoming times for this tour in bulk.</p>

      {/* Bundled Slots List */}
      {loading ? (
        <div className="text-xs text-[var(--ck-text-muted)] p-4 text-center">Loading schedule...</div>
      ) : bundled.length === 0 ? (
        <div className="text-xs text-[var(--ck-text-muted)] p-4 text-center rounded-xl border border-dashed border-[var(--ck-border-subtle)]">No upcoming schedules generated for this tour yet.</div>
      ) : (
        <div className="space-y-3">
          {bundled.map(([timeKey, items]) => {
             const totalBooked = items.reduce((acc, s) => acc + s.booked, 0);
             const openItems = items.filter(s => s.booked === 0 && s.held === 0);
             const hasBookings = totalBooked > 0;
             // Find current max capacity of this bundle
             const commonCap = items[0]?.capacity_total || 10;

             return (
               <div key={timeKey} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl bg-[var(--ck-bg-subtle)] border border-[var(--ck-border-subtle)]">
                 <div className="flex flex-col mb-3 sm:mb-0">
                   <div className="flex items-center gap-2">
                     <span className="text-base font-bold text-[var(--ck-text-strong)]">{timeKey}</span>
                     <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)]">{items.length} upcoming runs</span>
                   </div>
                   {hasBookings && <span className="text-xs text-amber-600 font-medium mt-1">Has active bookings ({totalBooked} total space reserved)</span>}
                 </div>
                 
                 <div className="flex items-center gap-3">
                   {editingBundleTime === timeKey ? (
                     <form onSubmit={(e) => handleBundleEdit(e, timeKey, items)} className="flex items-center gap-2 border-[var(--ck-border-strong)] pl-3 border-l">
                       <label className="text-[10px] text-[var(--ck-text-muted)] uppercase tracking-wider font-semibold">New Capacity:</label>
                       <input type="number" required min="1" autoFocus value={editCap} onChange={e => setEditCap(Number(e.target.value))} className="ui-control px-2 py-1 text-xs rounded-md w-16" />
                       <button type="submit" disabled={savingEdit} className="text-xs font-semibold text-white bg-[var(--ck-accent)] hover:bg-[var(--ck-accent-hover)] px-3 py-1 rounded-md transition-colors">Save</button>
                       <button type="button" onClick={() => setEditingBundleTime(null)} className="text-xs text-[var(--ck-text-muted)] hover:text-[var(--ck-text-strong)] font-medium">Cancel</button>
                     </form>
                   ) : (
                     <div className="flex items-center gap-4">
                       <div className="flex flex-col items-end">
                         <span className="text-xs text-[var(--ck-text-strong)] font-semibold">{commonCap} capacity</span>
                         <button type="button" onClick={() => { setEditCap(commonCap); setEditingBundleTime(timeKey); }} className="text-[10px] text-[var(--ck-accent)] font-semibold hover:underline flex items-center gap-1">
                           <PencilSimple size={12} weight="bold" /> Edit capacity
                         </button>
                       </div>
                       
                       <div className="w-px h-6 bg-[var(--ck-border-strong)] hidden sm:block"></div>
                       
                       <button type="button" onClick={() => handleBundleDelete(timeKey, items)} disabled={openItems.length === 0 || editingBundleTime === timeKey} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors disabled:opacity-40 disabled:hover:bg-red-50" title={openItems.length === 0 ? "Cannot delete times that only contain booked slots" : "Delete all upcoming empty slots at this time"}>
                         <Trash size={14} weight="bold" /> Delete Open 
                       </button>
                     </div>
                   )}
                 </div>
               </div>
             );
          })}
        </div>
      )}
    </div>
  );
}
