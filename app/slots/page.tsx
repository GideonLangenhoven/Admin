"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { confirmAction, notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { listAvailableSlots } from "../lib/slot-availability";
import { DatePicker } from "../../components/DatePicker";
import { useBusinessContext } from "../../components/BusinessContext";
import CalendarHeader from "../../components/CalendarHeader";
import WeekView from "../../components/WeekView";
import DayView from "../../components/DayView";
import { Slot } from "../../components/WeekView";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export default function SlotsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" /></div>}>
      <Slots />
    </Suspense>
  );
}

function Slots() {
  const { businessId } = useBusinessContext();
  const searchParams = useSearchParams();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [tours, setTours] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"week" | "day">("week");
  const [filterTourId, setFilterTourId] = useState<string | null>(() => searchParams.get("tour"));

  // Individual Edit State
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [editForm, setEditForm] = useState({ capacity: 0, price: "", status: "OPEN", time: "" });
  const [saving, setSaving] = useState(false);

  // Bulk Edit State
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    startDate: "",
    endDate: "",
    tourId: "ALL",
    capacity: "",
    price: "",
    newTime: "",
  });
  const [savingBulk, setSavingBulk] = useState(false);
  const [cancellingWeather, setCancellingWeather] = useState(false);

  // Add Slot State
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [addForm, setAddForm] = useState({
    tourId: "",
    time: "06:00",
    startDate: "",
    endDate: "",
    capacity: "12",
    price: "",
  });
  const [savingAdd, setSavingAdd] = useState(false);
  const [reopeningDay, setReopeningDay] = useState(false);

  // Cancel Day State
  const [showCancelDay, setShowCancelDay] = useState(false);
  const [showReopenDay, setShowReopenDay] = useState(false);
  const [selectedCancelDates, setSelectedCancelDates] = useState<string[]>([]);

  useEffect(() => {
    function syncViewMode() {
      if (window.innerWidth < 768) {
        setViewMode("day");
      }
    }
    syncViewMode();
    window.addEventListener("resize", syncViewMode);
    return () => window.removeEventListener("resize", syncViewMode);
  }, []);

  const toggleCancelDate = (dateStr: string) => {
    setSelectedCancelDates(prev => prev.includes(dateStr) ? prev.filter(d => d !== dateStr) : [...prev, dateStr]);
  };

  async function cancelSlotWeather(slot: Slot) {
    const slotLabel = new Date(slot.start_time).toLocaleString("en-ZA", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone(),
    }) + " — " + (slot.tours?.name || "Tour");

    if (!await confirmAction({
      title: "Cancel slot due to weather",
      message: `Cancel "${slotLabel}" due to weather? This closes the slot, cancels all bookings on it, and notifies customers with self-service options.`,
      tone: "warning",
      confirmLabel: "Cancel slot",
    })) return;

    setCancellingWeather(true);
    try {
      // 1. Close the slot
      await supabase.from("slots").update({ status: "CLOSED" }).eq("id", slot.id);

      // 2. Fetch all active bookings on this slot
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, customer_name, phone, email, qty, total_amount, status, yoco_checkout_id, tours(name), slots(start_time)")
        .eq("business_id", businessId)
        .eq("slot_id", slot.id)
        .in("status", ["PAID", "CONFIRMED", "HELD", "PENDING"]);

      const affected = bookings || [];
      let refundCount = 0;

      for (const b of affected) {
        const isPaidBooking = ["PAID", "CONFIRMED"].includes(b.status);
        const refundAmount = isPaidBooking ? Number(b.total_amount || 0) : 0;

        // Cancel the booking with weather reason (users will manage refunds/reschedules themselves)
        await supabase.from("bookings").update({
          status: "CANCELLED",
          cancellation_reason: "Weather cancellation",
          cancelled_at: new Date().toISOString(),
        }).eq("id", b.id);

        if (isPaidBooking && refundAmount > 0) refundCount++;

        // Release slot capacity
        const slotData = await supabase.from("slots").select("booked, held").eq("id", slot.id).single();
        if (slotData.data) {
          await supabase.from("slots").update({
            booked: Math.max(0, slotData.data.booked - b.qty),
            held: Math.max(0, (slotData.data.held || 0) - (b.status === "HELD" ? b.qty : 0)),
          }).eq("id", slot.id);
        }

        // Convert any active holds
        await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", b.id).eq("status", "ACTIVE");

        const ref = b.id.substring(0, 8).toUpperCase();
        const tourName = (b as any).tours?.name || "Tour";
        const startTime = (b as any).slots?.start_time
          ? new Date((b as any).slots.start_time).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() })
          : "";

        // Notify customer via WhatsApp
        if (b.phone) {
          try {
            await fetch(SU + "/functions/v1/send-whatsapp-text", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
              body: JSON.stringify({
                business_id: businessId,
                to: b.phone,
                message: "⛈ *Trip Cancelled — Weather*\n\n" +
                  "Hi " + (b.customer_name?.split(" ")[0] || "there") + ", unfortunately your " + tourName + " on " + startTime +
                  " has been cancelled due to weather conditions.\n\n" +
                  "📋 Ref: " + ref + "\n" +
                  (isPaidBooking && refundAmount > 0
                    ? "\n"
                    : "\n") +
                  "You will receive an email shortly with a link to manage your booking, where you can easily reschedule, get a voucher, or request a refund. 🛶",
              }),
            });
          } catch (e) { console.error("WA notify err:", e); }
        }

        // Notify customer via email
        if (b.email) {
          try {
            await supabase.functions.invoke("send-email", {
              body: {
                type: "CANCELLATION",
                data: {
                  email: b.email,
                  customer_name: b.customer_name,
                  ref,
                  tour_name: tourName,
                  start_time: startTime,
                  reason: "weather conditions",
                  refund_amount: isPaidBooking && refundAmount > 0 ? refundAmount : null,
                },
              },
            });
          } catch (e) { console.error("Email notify err:", e); }
        }
      }

      notify({
        title: "Weather cancellation complete",
        message: `${affected.length} booking(s) were cancelled and notified with self-service follow-up links.`,
        tone: "success",
      });
      setSelectedSlot(null);
      load();
    } catch (err) {
      notify({
        title: "Weather cancellation failed",
        message: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    }
    setCancellingWeather(false);
  }

  async function handleCancelDay() {
    if (selectedCancelDates.length === 0) return;
    if (!await confirmAction({
      title: "Cancel selected days",
      message: `Cancel all slots for ${selectedCancelDates.length} selected day(s) due to weather? This closes the slots, cancels active bookings, and notifies customers.`,
      tone: "warning",
      confirmLabel: "Cancel selected days",
    })) return;

    setCancellingWeather(true);
    try {
      const allSlotIds: string[] = [];

      for (const dateStr of selectedCancelDates) {
        const startOfDay = new Date(dateStr + "T00:00:00+02:00").toISOString();
        const endOfDay = new Date(dateStr + "T23:59:59+02:00").toISOString();

        const { data: slotsToCancel, error: fetchErr } = await supabase
          .from("slots")
          .select("id")
          .gte("start_time", startOfDay)
          .lte("start_time", endOfDay)
          .eq("business_id", businessId);

        if (fetchErr) throw fetchErr;

        if (slotsToCancel && slotsToCancel.length > 0) {
          allSlotIds.push(...slotsToCancel.map(s => s.id));
        }
      }

      if (allSlotIds.length === 0) {
        notify({ title: "No slots found", message: "No slots were found for the selected dates.", tone: "warning" });
        setCancellingWeather(false);
        return;
      }

      await supabase.from("slots").update({ status: "CLOSED" }).in("id", allSlotIds);

      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, customer_name, phone, email, qty, total_amount, status, yoco_checkout_id, tours(name), slots(start_time), slot_id")
        .eq("business_id", businessId)
        .in("slot_id", allSlotIds)
        .in("status", ["PAID", "CONFIRMED", "HELD", "PENDING"]);

      const affected = bookings || [];

      for (const b of affected) {
        const isPaidBooking = ["PAID", "CONFIRMED"].includes(b.status);
        const refundAmount = isPaidBooking ? Number(b.total_amount || 0) : 0;

        await supabase.from("bookings").update({
          status: "CANCELLED",
          cancellation_reason: "Weather cancellation",
          cancelled_at: new Date().toISOString(),
        }).eq("id", b.id);

        const slotData = await supabase.from("slots").select("booked, held").eq("id", b.slot_id).single();
        if (slotData.data) {
          await supabase.from("slots").update({
            booked: Math.max(0, slotData.data.booked - b.qty),
            held: Math.max(0, (slotData.data.held || 0) - (b.status === "HELD" ? b.qty : 0)),
          }).eq("id", b.slot_id);
        }

        await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", b.id).eq("status", "ACTIVE");

        const ref = b.id.substring(0, 8).toUpperCase();
        const tourName = (b as any).tours?.name || "Tour";
        const startTime = (b as any).slots?.start_time
          ? new Date((b as any).slots.start_time).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() })
          : "";

        if (b.phone) {
          try {
            await fetch(SU + "/functions/v1/send-whatsapp-text", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
              body: JSON.stringify({
                business_id: businessId,
                to: b.phone,
                message: "⛈ *Trip Cancelled — Weather*\n\n" +
                  "Hi " + (b.customer_name?.split(" ")[0] || "there") + ", unfortunately your " + tourName + " on " + startTime +
                  " has been cancelled due to weather conditions.\n\n" +
                  "📋 Ref: " + ref + "\n\n" +
                  "You will receive an email shortly with a link to manage your booking, where you can easily reschedule, get a voucher, or request a refund. 🛶",
              }),
            });
          } catch (e) { console.error("WA notify err:", e); }
        }

        if (b.email) {
          try {
            await supabase.functions.invoke("send-email", {
              body: {
                type: "CANCELLATION",
                data: {
                  email: b.email,
                  customer_name: b.customer_name,
                  ref,
                  tour_name: tourName,
                  start_time: startTime,
                  reason: "weather conditions",
                  refund_amount: isPaidBooking && refundAmount > 0 ? refundAmount : null,
                },
              },
            });
          } catch (e) { console.error("Email notify err:", e); }
        }
      }

      notify({
        title: "Selected days cancelled",
        message: `${allSlotIds.length} slot(s) were closed and ${affected.length} booking(s) were cancelled across ${selectedCancelDates.length} day(s).`,
        tone: "success",
      });
      setShowCancelDay(false);
      setSelectedCancelDates([]);
      load();
    } catch (err: any) {
      notify({ title: "Day cancellation failed", message: err.message, tone: "error" });
    }
    setCancellingWeather(false);
  }

  async function handleReopenDay() {
    if (selectedCancelDates.length === 0) return;
    if (!await confirmAction({
      title: "Reopen selected days",
      message: `Reopen all closed slots for ${selectedCancelDates.length} selected day(s)? This will make those slots available for bookings again.`,
      tone: "info",
      confirmLabel: "Reopen slots",
    })) return;

    setReopeningDay(true);
    try {
      const allSlotIds: string[] = [];

      for (const dateStr of selectedCancelDates) {
        const startOfDay = new Date(dateStr + "T00:00:00+02:00").toISOString();
        const endOfDay = new Date(dateStr + "T23:59:59+02:00").toISOString();

        const { data: slotsToReopen, error: fetchErr } = await supabase
          .from("slots")
          .select("id")
          .gte("start_time", startOfDay)
          .lte("start_time", endOfDay)
          .eq("status", "CLOSED")
          .eq("business_id", businessId);

        if (fetchErr) throw fetchErr;

        if (slotsToReopen && slotsToReopen.length > 0) {
          allSlotIds.push(...slotsToReopen.map(s => s.id));
        }
      }

      if (allSlotIds.length === 0) {
        notify({ title: "Nothing to reopen", message: "No closed slots were found for the selected dates.", tone: "warning" });
        setReopeningDay(false);
        return;
      }

      const { error: updateErr } = await supabase
        .from("slots")
        .update({ status: "OPEN" })
        .in("id", allSlotIds);

      if (updateErr) throw updateErr;

      notify({
        title: "Days reopened",
        message: `Reopened ${allSlotIds.length} slot(s) across ${selectedCancelDates.length} selected day(s).`,
        tone: "success",
      });
      setShowReopenDay(false);
      setSelectedCancelDates([]);
      load();
    } catch (err: any) {
      notify({ title: "Reopen failed", message: err.message, tone: "error" });
    }
    setReopeningDay(false);
  }

  useEffect(() => { loadTours(); }, [businessId]);
  useEffect(() => { load(); }, [currentDate, viewMode, businessId]);

  async function loadTours() {
    const { data } = await supabase.from("tours").select("id, name, business_id").eq("business_id", businessId).order("name");
    if (data) setTours(data);
  }

  async function load() {
    setLoading(true);

    // Calculate time range based on view mode
    let start = new Date(currentDate);
    start.setHours(0, 0, 0, 0);
    let end = new Date(currentDate);
    end.setHours(23, 59, 59, 999);

    if (viewMode === "week") {
      const day = start.getDay();
      // Adjust to Monday start (0=Sun, 1=Mon...6=Sat)
      // If Sun(0), Monday is -6 days away. If Mon(1), 0 days away. If Tue(2), -1 day away.
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      // End of week is start + 6 days
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    }

    try {
      const [slotRes, openAvailability] = await Promise.all([
        supabase.from("slots")
          .select("id, start_time, capacity_total, booked, held, status, price_per_person_override, tour_id, tours(id, name)")
          .eq("business_id", businessId)
          .gte("start_time", start.toISOString())
          .lte("start_time", end.toISOString())
          .order("start_time", { ascending: true }),
        listAvailableSlots({
          businessId,
          startIso: start.toISOString(),
          endIso: new Date(end.getTime() + 1).toISOString(),
          tourId: filterTourId,
        }),
      ]);

      if (slotRes.error) throw slotRes.error;

      const availabilityBySlotId = new Map(
        openAvailability.map((slot) => [slot.id, Number(slot.available_capacity || 0)]),
      );

      const normalized = (slotRes.data || []).map((d: any) => ({
        ...d,
        tours: Array.isArray(d.tours) ? d.tours[0] : d.tours,
        available_capacity: availabilityBySlotId.get(d.id),
      }));

      setSlots(normalized as Slot[]);
    } catch (error) {
      console.error("Failed to load slots:", error);
      notify({
        title: "Could not load slots",
        message: error instanceof Error ? error.message : "There was a problem loading slot availability.",
        tone: "error",
      });
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSlotClick(slot: Slot) {
    setSelectedSlot(slot);

    // Extract local time from the UTC timestamp (SAST is UTC+2)
    const sastDate = new Date(new Date(slot.start_time).getTime() + 2 * 60 * 60 * 1000);
    const hrs = String(sastDate.getUTCHours()).padStart(2, "0");
    const mins = String(sastDate.getUTCMinutes()).padStart(2, "0");

    setEditForm({
      capacity: slot.capacity_total,
      price: slot.price_per_person_override !== null ? String(slot.price_per_person_override) : "",
      status: slot.status,
      time: `${hrs}:${mins}`,
    });
  }

  async function saveSlotEdit() {
    if (!selectedSlot) return;
    if (!editForm.time) {
      notify({ title: "Time required", message: "Please enter a valid time.", tone: "warning" });
      return;
    }

    setSaving(true);

    const priceVal = editForm.price.trim() === "" ? null : Number(editForm.price);

    // Compute new UTC timestamp based on old date + new time
    const [newHours, newMins] = editForm.time.split(":").map(Number);
    const oldSastDate = new Date(new Date(selectedSlot.start_time).getTime() + 2 * 60 * 60 * 1000);

    // Store original hours/mins to check if time actually changed
    const originalHrs = oldSastDate.getUTCHours();
    const originalMins = oldSastDate.getUTCMinutes();
    const timeChanged = (originalHrs !== newHours || originalMins !== newMins);

    oldSastDate.setUTCHours(newHours, newMins, 0, 0); // Apply new local time
    const newUtcTime = new Date(oldSastDate.getTime() - 2 * 60 * 60 * 1000); // Back to UTC

    try {
      // Always update the single slot we clicked
      let { error: singleUpdateError } = await supabase
        .from("slots")
        .update({
          capacity_total: Number(editForm.capacity) || selectedSlot.capacity_total,
          price_per_person_override: priceVal,
          status: editForm.status,
          start_time: newUtcTime.toISOString()
        })
        .eq("id", selectedSlot.id);

      if (singleUpdateError) throw singleUpdateError;

      // If time changed, auto-update all targeted future slots for this tour matching the old time
      if (timeChanged) {
        const oldTimeString = `${String(originalHrs).padStart(2, "0")}:${String(originalMins).padStart(2, "0")}`;
        const newTimeString = `${String(newHours).padStart(2, "0")}:${String(newMins).padStart(2, "0")}`;

        if (await confirmAction({
          title: "Move matching future slots",
          message: `Would you also like to move all future ${oldTimeString} slots across all days to ${newTimeString}?`,
          tone: "info",
          confirmLabel: "Move future slots",
        })) {
          // Fetch all slots for this tour that happen AFTER the original select slot's UTC time.
          const targetTourId = (selectedSlot as any).tour_id || (selectedSlot.tours as any)?.id;
          const { data: futureSlots, error: futureErr } = await supabase
            .from("slots")
            .select("id, start_time")
            .eq("tour_id", targetTourId)
            .gt("start_time", selectedSlot.start_time);

          if (futureErr) throw futureErr;

          if (futureSlots) {
            const promises = futureSlots.map(slot => {
              // Extract SAST time of future slot
              const slotSastDate = new Date(new Date(slot.start_time).getTime() + 2 * 60 * 60 * 1000);
              const slotHrs = slotSastDate.getUTCHours();
              const slotMins = slotSastDate.getUTCMinutes();

              // Only update if it matches the EXACT original local time (e.g. 07:00)
              if (slotHrs === originalHrs && slotMins === originalMins) {
                slotSastDate.setUTCHours(newHours, newMins, 0, 0); // shift to new time
                const slotNewUtc = new Date(slotSastDate.getTime() - 2 * 60 * 60 * 1000);

                return supabase.from("slots").update({
                  start_time: slotNewUtc.toISOString()
                }).eq("id", slot.id);
              }
              return null;
            }).filter(Boolean); // remove nulls

            if (promises.length > 0) {
              await Promise.all(promises);
              notify({
                title: "Future slots moved",
                message: `Moved ${promises.length} future slot${promises.length === 1 ? "" : "s"} to ${newTimeString}.`,
                tone: "success",
              });
            }
          }
        }
      }

      setSelectedSlot(null);
      load();
    } catch (err: any) {
      notify({ title: "Slot update failed", message: "Error saving slot: " + err.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function saveBulkEdit() {
    if (!bulkForm.startDate || !bulkForm.endDate) {
      notify({ title: "Date range required", message: "Please select a start and end date.", tone: "warning" });
      return;
    }

    if (bulkForm.capacity === "" && bulkForm.price === "" && bulkForm.newTime === "") {
      notify({ title: "No changes provided", message: "Please enter a new capacity, price, or time to apply.", tone: "warning" });
      return;
    }

    setSavingBulk(true);

    const baseUpdates: any = {};
    if (bulkForm.capacity !== "") baseUpdates.capacity_total = Number(bulkForm.capacity);
    if (bulkForm.price !== "") baseUpdates.price_per_person_override = bulkForm.price === "NULL" ? null : Number(bulkForm.price);

    try {
      if (bulkForm.newTime !== "") {
        // Need to fetch slots to manually calculate new start_time keeping the same date
        let fetchQuery = supabase
          .from("slots")
          .select("id, start_time")
          .gte("start_time", `${bulkForm.startDate}T00:00:00`)
          .lte("start_time", `${bulkForm.endDate}T23:59:59`);

        if (bulkForm.tourId !== "ALL") fetchQuery = fetchQuery.eq("tour_id", bulkForm.tourId);

        const { data: slotsToUpdate, error: fetchErr } = await fetchQuery;
        if (fetchErr) throw fetchErr;

        if (slotsToUpdate) {
          const [newHours, newMins] = bulkForm.newTime.split(":").map(Number);
          const promises = slotsToUpdate.map(slot => {
            // SAST is UTC+2. Shift time by +2 hours to get wall-clock UTC equivalent.
            const sastDate = new Date(new Date(slot.start_time).getTime() + 2 * 60 * 60 * 1000);
            sastDate.setUTCHours(newHours, newMins, 0, 0); // Set new wall clock time

            // Convert back to true UTC
            const finalUtcTime = new Date(sastDate.getTime() - 2 * 60 * 60 * 1000);

            return supabase.from("slots").update({
              ...baseUpdates,
              start_time: finalUtcTime.toISOString()
            }).eq("id", slot.id);
          });

          await Promise.all(promises);
        }
      } else {
        // Simple update across all matches
        let query = supabase
          .from("slots")
          .update(baseUpdates)
          .gte("start_time", `${bulkForm.startDate}T00:00:00`)
          .lte("start_time", `${bulkForm.endDate}T23:59:59`);

        if (bulkForm.tourId !== "ALL") {
          query = query.eq("tour_id", bulkForm.tourId);
        }

        const { error } = await query;
        if (error) throw error;
      }

      setShowBulkEdit(false);
      setBulkForm({ startDate: "", endDate: "", tourId: "ALL", capacity: "", price: "", newTime: "" });
      notify({ title: "Bulk update applied", message: "The selected slots were updated successfully.", tone: "success" });
      load();
    } catch (err: any) {
      notify({ title: "Bulk update failed", message: "Error applying bulk update: " + err.message, tone: "error" });
    } finally {
      setSavingBulk(false);
    }
  }

  async function saveAddSlot() {
    if (!addForm.tourId) { notify({ title: "Tour required", message: "Please select a tour.", tone: "warning" }); return; }
    if (!addForm.startDate || !addForm.endDate) { notify({ title: "Date range required", message: "Please select start and end dates.", tone: "warning" }); return; }
    if (!addForm.time) { notify({ title: "Time required", message: "Please enter a time.", tone: "warning" }); return; }
    if (!addForm.capacity || Number(addForm.capacity) <= 0) { notify({ title: "Invalid capacity", message: "Please enter a valid capacity.", tone: "warning" }); return; }

    setSavingAdd(true);

    const [hours, mins] = addForm.time.split(":").map(Number);
    const priceOverride = addForm.price.trim() === "" ? null : Number(addForm.price);

    const start = new Date(addForm.startDate + "T00:00:00");
    const end = new Date(addForm.endDate + "T00:00:00");
    const rows: any[] = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const slotTime = new Date(d);
      slotTime.setHours(hours, mins, 0, 0);
      // Convert SA local to UTC — SA is UTC+2
      const utcTime = new Date(slotTime.getTime() - 2 * 60 * 60 * 1000);

      rows.push({
        tour_id: addForm.tourId,
        start_time: utcTime.toISOString(),
        capacity_total: Number(addForm.capacity),
        booked: 0,
        held: 0,
        status: "OPEN",
        price_per_person_override: priceOverride,
        business_id: businessId,
      });
    }

    if (rows.length === 0) {
      notify({ title: "No matching dates", message: "No dates in the selected range matched the slot criteria.", tone: "warning" });
      setSavingAdd(false);
      return;
    }

    const { error } = await supabase.from("slots").insert(rows);
    setSavingAdd(false);

    if (error) {
      notify({ title: "Slot creation failed", message: "Error creating slots: " + error.message, tone: "error" });
    } else {
      setShowAddSlot(false);
      setAddForm({ tourId: "", time: "06:00", startDate: "", endDate: "", capacity: "12", price: "" });
      notify({
        title: "Slots created",
        message: rows.length + " slot(s) created successfully.",
        tone: "success",
      });
      load();
    }
  }

  const filteredSlots = filterTourId ? slots.filter(s => (s as any).tour_id === filterTourId || (s.tours as any)?.id === filterTourId) : slots;
  const filterTourName = filterTourId ? tours.find(t => t.id === filterTourId)?.name : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl sm:text-2xl font-bold">Slot Management</h2>
          {filterTourName && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
              {filterTourName}
              <button onClick={() => setFilterTourId(null)} className="ml-0.5 text-emerald-600 hover:text-emerald-900 font-bold">×</button>
            </span>
          )}
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto">
          <button
            onClick={() => {
              if (selectedCancelDates.length === 0) {
                notify({
                  title: "Select dates first",
                  message: "Click the date headers on the calendar before cancelling days.",
                  tone: "warning",
                });
                return;
              }
              setShowCancelDay(true);
            }}
            className={`px-3 py-2 font-medium rounded-lg transition-colors text-sm ${selectedCancelDates.length > 0 ? 'bg-red-600 border border-red-700 text-white hover:bg-red-700' : 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100'}`}
          >
            ⛈ Cancel Day(s) {selectedCancelDates.length > 0 ? `(${selectedCancelDates.length})` : ""}
          </button>
          <button
            onClick={() => {
              if (selectedCancelDates.length === 0) {
                notify({
                  title: "Select dates first",
                  message: "Click the date headers on the calendar before reopening days.",
                  tone: "warning",
                });
                return;
              }
              setShowReopenDay(true);
            }}
            className={`px-3 py-2 font-medium rounded-lg transition-colors text-sm ${selectedCancelDates.length > 0 ? 'bg-green-600 border border-green-700 text-white hover:bg-green-700' : 'border border-green-300 bg-green-50 text-green-700 hover:bg-green-100'}`}
          >
            🔓 Reopen Day(s) {selectedCancelDates.length > 0 ? `(${selectedCancelDates.length})` : ""}
          </button>
          <button
            onClick={() => { if (tours.length > 0) setAddForm(f => ({ ...f, tourId: f.tourId || tours[0].id })); setShowAddSlot(true); }}
            className="px-3 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            + Add Slot
          </button>
          <button
            onClick={() => setShowBulkEdit(true)}
            className="px-3 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            Bulk Edit
          </button>
        </div>
      </div>

      <CalendarHeader
        currentDate={currentDate}
        viewMode={viewMode}
        onDateChange={setCurrentDate}
        onViewModeChange={setViewMode}
      />

      {loading ? (
        <div className="flex items-center justify-center h-64 bg-white rounded-xl border border-gray-200">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        viewMode === "week" ? (
          <WeekView
            slots={filteredSlots}
            currentDate={currentDate}
            onSlotClick={handleSlotClick}
            selectedCancelDates={selectedCancelDates}
            onToggleCancelDate={toggleCancelDate}
          />
        ) : (
          <DayView
            slots={filteredSlots}
            currentDate={currentDate}
            onSlotClick={handleSlotClick}
            selectedCancelDates={selectedCancelDates}
            onToggleCancelDate={toggleCancelDate}
          />
        )
      )}

      {selectedSlot && (() => {
        const directAvailability = selectedSlot.capacity_total - selectedSlot.booked - (selectedSlot.held || 0);
        const effectiveAvailability = typeof selectedSlot.available_capacity === "number" ? selectedSlot.available_capacity : directAvailability;
        const isResourceLimited = effectiveAvailability < directAvailability;
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white rounded-t-2xl sm:rounded-xl w-full sm:max-w-md max-h-[90vh] overflow-auto p-6 shadow-xl">
            <h3 className="text-xl font-bold mb-1">Edit Slot</h3>
            <p className="text-sm text-gray-500 mb-4">
              {new Date(selectedSlot.start_time).toLocaleString("en-ZA", {
                weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone()
              })} — {selectedSlot.tours?.name}
            </p>

            <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Sellable now</div>
                <div className={`mt-1 text-lg font-semibold ${effectiveAvailability > 0 ? "text-emerald-600" : "text-gray-400"}`}>{effectiveAvailability}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Raw slot space</div>
                <div className="mt-1 text-lg font-semibold text-gray-800">{directAvailability}</div>
              </div>
              {isResourceLimited && (
                <div className="col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  Shared resource limits are reducing capacity for this slot. Increasing the slot max alone will not create more availability unless the linked shared resources also allow it.
                </div>
              )}
            </div>

            <div className="space-y-4">
              <label className="block text-sm text-gray-600">
                Status
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="OPEN">OPEN</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </label>

              <label className="block text-sm text-gray-600">
                Time
                <input
                  type="time"
                  value={editForm.time}
                  onChange={(e) => setEditForm({ ...editForm, time: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm text-gray-600">
                Max Capacity
                <input
                  type="number"
                  min="0"
                  value={editForm.capacity}
                  onChange={(e) => setEditForm({ ...editForm, capacity: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm text-gray-600">
                Price Override (ZAR)
                <span className="block text-xs text-gray-400 mb-1">Leave blank to use the default tour base amount.</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 600"
                  value={editForm.price}
                  onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={() => cancelSlotWeather(selectedSlot)}
                disabled={cancellingWeather || saving || selectedSlot.status === "CLOSED"}
                className="w-full rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 sm:w-auto"
              >
                {cancellingWeather ? "Cancelling..." : "⛈ Cancel Weather"}
              </button>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button
                  onClick={() => setSelectedSlot(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSlotEdit}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* BULK EDIT MODAL */}
      {showBulkEdit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl w-full sm:max-w-md max-h-[90vh] overflow-visible p-6 shadow-xl">
            <h3 className="text-xl font-bold mb-1">Bulk Edit Slots</h3>
            <p className="text-sm text-gray-500 mb-4">
              Apply new capacities or base amounts to multiple slots at once.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm text-gray-600">
                  Start Date
                  <div className="mt-1">
                    <DatePicker position="top" value={bulkForm.startDate} onChange={(v) => setBulkForm({ ...bulkForm, startDate: v })} className="py-2.5 w-full border-gray-300" />
                  </div>
                </label>
                <label className="block text-sm text-gray-600">
                  End Date (Inclusive)
                  <div className="mt-1">
                    <DatePicker position="top" value={bulkForm.endDate} onChange={(v) => setBulkForm({ ...bulkForm, endDate: v })} className="py-2.5 w-full border-gray-300" />
                  </div>
                </label>
              </div>

              <label className="block text-sm text-gray-600">
                Tour
                <select
                  value={bulkForm.tourId}
                  onChange={(e) => setBulkForm({ ...bulkForm, tourId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="ALL">All Tours</option>
                  {tours.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              <label className="block text-sm text-gray-600">
                New Time
                <span className="block text-xs text-gray-400 mb-1">Leave blank to keep existing times.</span>
                <input
                  type="time"
                  value={bulkForm.newTime}
                  onChange={(e) => setBulkForm({ ...bulkForm, newTime: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm text-gray-600">
                New Max Capacity
                <span className="block text-xs text-gray-400 mb-1">Leave blank to keep existing capacities.</span>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 24"
                  value={bulkForm.capacity}
                  onChange={(e) => setBulkForm({ ...bulkForm, capacity: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm text-gray-600">
                New Base Price (ZAR)
                <span className="block text-xs text-gray-400 mb-1">Leave blank to keep existing prices. Type "NULL" to reset to default base amount.</span>
                <input
                  type="text"
                  placeholder="e.g. 650 or NULL"
                  value={bulkForm.price}
                  onChange={(e) => setBulkForm({ ...bulkForm, price: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-2 sm:flex sm:justify-end">
              <button
                onClick={() => setShowBulkEdit(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveBulkEdit}
                disabled={savingBulk || !bulkForm.startDate || !bulkForm.endDate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {savingBulk ? "Applying..." : "Apply Bulk Update"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD SLOT MODAL */}
      {showAddSlot && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl w-full sm:max-w-md max-h-[90vh] overflow-visible p-6 shadow-xl">
            <h3 className="text-xl font-bold mb-1">Add New Slots</h3>
            <p className="text-sm text-gray-500 mb-4">
              Create slots for a time across a date range.
            </p>

            <div className="space-y-4">
              <label className="block text-sm text-gray-600">
                Tour
                <select
                  value={addForm.tourId}
                  onChange={(e) => setAddForm({ ...addForm, tourId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                >
                  <option value="">Select a tour...</option>
                  {tours.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              <label className="block text-sm text-gray-600">
                Time (SA Time)
                <input
                  type="time"
                  value={addForm.time}
                  onChange={(e) => setAddForm({ ...addForm, time: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                />
              </label>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm text-gray-600">
                  Start Date
                  <div className="mt-1">
                    <DatePicker position="top" value={addForm.startDate} onChange={(val) => setAddForm({ ...addForm, startDate: val })} className="py-2.5 w-full border-gray-300" />
                  </div>
                </label>
                <label className="block text-sm text-gray-600">
                  End Date
                  <div className="mt-1">
                    <DatePicker position="top" value={addForm.endDate} onChange={(val) => setAddForm({ ...addForm, endDate: val })} className="py-2.5 w-full border-gray-300" />
                  </div>
                </label>
              </div>

              <label className="block text-sm text-gray-600">
                Max Capacity
                <input
                  type="number"
                  min="1"
                  value={addForm.capacity}
                  onChange={(e) => setAddForm({ ...addForm, capacity: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                />
              </label>

              <label className="block text-sm text-gray-600">
                Price Override (ZAR)
                <span className="block text-xs text-gray-400 mb-1">Leave blank to use the tour&apos;s default price.</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 600"
                  value={addForm.price}
                  onChange={(e) => setAddForm({ ...addForm, price: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                />
              </label>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-2 sm:flex sm:justify-end">
              <button
                onClick={() => setShowAddSlot(false)}
                className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveAddSlot}
                disabled={savingAdd || !addForm.tourId || !addForm.startDate || !addForm.endDate}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {savingAdd ? "Creating..." : "Create Slots"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL DAY MODAL */}
      {showCancelDay && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm overflow-visible p-6 shadow-xl">
            <h3 className="text-xl font-bold mb-1 text-red-700">Cancel ({selectedCancelDates.length}) Day(s)</h3>
            <p className="text-sm text-gray-500 mb-4">
              You are about to close all slots and cancel active bookings due to weather for the following days:
            </p>

            <div className="space-y-2 max-h-[30vh] overflow-y-auto mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <ul className="list-disc pl-5">
                {selectedCancelDates.map((date) => (
                  <li key={date} className="font-semibold text-gray-800 text-sm">{new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</li>
                ))}
              </ul>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-2 sm:flex sm:justify-end">
              <button
                onClick={() => setShowCancelDay(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                Go Back
              </button>
              <button
                onClick={handleCancelDay}
                disabled={cancellingWeather || selectedCancelDates.length === 0}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {cancellingWeather ? "Cancelling..." : "Cancel Everything"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REOPEN DAY MODAL */}
      {showReopenDay && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm overflow-visible p-6 shadow-xl">
            <h3 className="text-xl font-bold mb-1 text-green-700">Reopen ({selectedCancelDates.length}) Day(s)</h3>
            <p className="text-sm text-gray-500 mb-4">
              You are about to reopen all closed slots for the following days. Bookings will be enabled again.
            </p>

            <div className="space-y-2 max-h-[30vh] overflow-y-auto mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <ul className="list-disc pl-5">
                {selectedCancelDates.map((date) => (
                  <li key={date} className="font-semibold text-gray-800 text-sm">{new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</li>
                ))}
              </ul>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-2 sm:flex sm:justify-end">
              <button
                onClick={() => setShowReopenDay(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReopenDay}
                disabled={reopeningDay || selectedCancelDates.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {reopeningDay ? "Reopening..." : "Reopen Slots"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
