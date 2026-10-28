"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { List } from "@phosphor-icons/react";
import { useSearchParams } from "next/navigation";
import { CANCEL_OPTIONS, confirmCancellation, describeOptions } from "../lib/cancellation-choice";
import { confirmAction, notify } from "../lib/app-notify";
import { getAdminTimezone, zonedToUtc, utcToLocalParts, changeLocalTime, normalize24HourTime } from "../lib/admin-timezone";
import { businessDateKey, businessDayRange, isDateKey } from "../lib/simple-view";
import { supabase } from "../lib/supabase";
import { DatePicker } from "../../components/DatePicker";
import { useBusinessContext } from "../../components/BusinessContext";
import CalendarHeader from "../../components/CalendarHeader";
import OptionToggles from "../../components/OptionToggles";
import WeekView from "../../components/WeekView";
import DayView from "../../components/DayView";
import { Slot } from "../../components/WeekView";
import BulkSlotWizard from "../../components/BulkSlotWizard";
import BookingsMonthCalendar from "../../components/BookingsMonthCalendar";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function TimeInput({ name, value, onChange }: { name?: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder="HH:MM"
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const normalized = normalize24HourTime(value);
        if (normalized) onChange(normalized);
      }}
      className="ui-control mt-1 w-full tabular-nums"
    />
  );
}

export default function SlotsPage() {
  return (
    <Suspense fallback={<div className="space-y-4 py-2"><div className="ui-skeleton h-8 w-48" /><div className="ui-skeleton h-[140px] !rounded-2xl" /><div className="ui-skeleton h-[320px] !rounded-2xl" /></div>}>
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
  const [showClosedSlots, setShowClosedSlots] = useState(false);
  const [monthViewOpen, setMonthViewOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeMenu(event: PointerEvent | KeyboardEvent) {
      const menu = mobileMenuRef.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        menu.querySelector("summary")?.focus();
      } else if (menu.contains(event.target as Node)) return;
      menu.open = false;
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, []);

  // Individual Edit State
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [editForm, setEditForm] = useState({ capacity: 0, price: "", status: "OPEN", time: "" });
  const [saving, setSaving] = useState(false);

  // Bulk Edit State
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    startDate: "",
    endDate: "",
    tourId: searchParams.get("tour") || "ALL",
    capacity: "",
    price: "",
    newTime: "",
  });
  const [savingBulk, setSavingBulk] = useState(false);
  const [cancellingWeather, setCancellingWeather] = useState(false);

  // Add Slot State
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [bulkGenOpen, setBulkGenOpen] = useState(false);

  // Deep-link the action dialogs (used by the help assistant's [[open]]):
  // /slots?panel=add or /slots?panel=bulk-edit opens the dialog directly.
  useEffect(() => {
    const panel = searchParams.get("panel");
    if (panel === "add") setShowAddSlot(true);
    else if (panel === "bulk-edit") setShowBulkEdit(true);
  }, [searchParams]);
  const [addForm, setAddForm] = useState({
    tourId: "",
    time: "06:00",
    // Multiple ranges so seasonal availability (e.g. 1–3 Mar AND 20–23 Mar)
    // is one submit instead of several.
    ranges: [{ start: "", end: "" }] as Array<{ start: string; end: string }>,
    capacity: "12",
    price: "",
  });
  const today = businessDateKey(getAdminTimezone()); // earliest date Add slot offers
  const [savingAdd, setSavingAdd] = useState(false);
  // A number input reports "" for text it cannot parse (e.g. "R600"), which
  // used to save the slot with no price override and no warning.
  const [addPriceInvalid, setAddPriceInvalid] = useState(false);
  const [reopeningDay, setReopeningDay] = useState(false);

  // Cancel Day State
  const [showCancelDay, setShowCancelDay] = useState(false);
  const [cancelDayOfferChoice, setCancelDayOfferChoice] = useState(true);
  const [cancelDayOptions, setCancelDayOptions] = useState(() => CANCEL_OPTIONS.map((option) => option.id));
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
    }) + ": " + (slot.tours?.name || "Tour");

    const handling = await confirmCancellation("Cancel slot due to weather", `Cancel "${slotLabel}" due to weather? This closes the slot, cancels all bookings and notifies customers.`);
    if (!handling) return;

    setCancellingWeather(true);
    try {
      // Delegate to weather-cancel edge function — single source of truth, atomic per-slot capacity
      // releases, customer notifications, and self-service compensation links. Avoids N+1 reads.
      const { data, error } = await supabase.functions.invoke("weather-cancel", {
        body: { slot_ids: [slot.id], business_id: businessId, reason: "weather conditions", offer_choice: handling.offerChoice },
      });
      if (error) throw error;
      const cancelled = (data as any)?.bookings_cancelled ?? 0;
      notify({
        title: "Weather cancellation complete",
        message: `${cancelled} booking(s) cancelled and customers notified.${handling.offerChoice ? " Customer options enabled." : " Follow-up remains with you."}`,
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

  // ── Item 20: Close and Cancel are two DISTINCT actions ──
  // Close = stop new bookings only; existing bookings stand, nobody is
  // notified, no refund. Cancel = cancel everyone's trip, notify them, and
  // start the refund flow. They used to be conflated (choosing "CLOSED" in a
  // dropdown silently cancelled every booking).
  const [slotStatusSaving, setSlotStatusSaving] = useState(false);
  const [cancellingSlot, setCancellingSlot] = useState(false);

  async function closeSlot(slot: Slot) {
    const bookedSeats = slot.booked || 0;
    if (!await confirmAction({
      title: "Close this slot?",
      message: bookedSeats > 0
        ? `This stops NEW bookings only. The ${bookedSeats} seat(s) already booked keep their trip; nobody is notified. To cancel those trips instead, use "Cancel & notify guests".`
        : "This stops new bookings for this slot. It has no bookings yet, so nothing else changes. You can reopen it any time.",
      tone: "info",
      confirmLabel: "Close slot",
    })) return;
    setSlotStatusSaving(true);
    const { error } = await supabase.from("slots").update({ status: "CLOSED" }).eq("id", slot.id).eq("business_id", businessId);
    setSlotStatusSaving(false);
    if (error) { notify({ title: "Couldn't close slot", message: error.message, tone: "error" }); return; }
    notify({ title: "Slot closed", message: "No new bookings will be taken. Existing bookings are unaffected.", tone: "success" });
    setSelectedSlot(null);
    load();
  }

  async function reopenSlot(slot: Slot) {
    setSlotStatusSaving(true);
    const { error } = await supabase.from("slots").update({ status: "OPEN" }).eq("id", slot.id).eq("business_id", businessId);
    setSlotStatusSaving(false);
    if (error) { notify({ title: "Couldn't reopen slot", message: error.message, tone: "error" }); return; }
    notify({ title: "Slot reopened", message: "This slot is accepting bookings again.", tone: "success" });
    setSelectedSlot(null);
    load();
  }

  // The generic FunctionsHttpError message ("non-2xx status code") hides the
  // real cause — pull the response body so the operator sees what failed.
  async function describeFnError(err: unknown): Promise<string> {
    const anyErr = err as { context?: Response; message?: string };
    if (anyErr?.context && typeof anyErr.context.text === "function") {
      try {
        const body = await anyErr.context.text();
        if (body) return `HTTP ${anyErr.context.status}: ${body.slice(0, 300)}`;
      } catch { /* fall through */ }
    }
    return err instanceof Error ? err.message : String(err);
  }

  async function cancelSlotAndRefund(slot: Slot, isWeather = false) {
    const bookedSeats = slot.booked || 0;
    const slotLabel = new Date(slot.start_time).toLocaleString("en-ZA", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone(),
    }) + ": " + (slot.tours?.name || "Tour");
    const handling = await confirmCancellation(
      isWeather ? "Weather-cancel this trip?" : "Cancel this trip for all guests?",
      bookedSeats > 0
        ? `Cancel "${slotLabel}" for ${bookedSeats} booked seat(s)? This closes the slot and notifies customers. Use Close to stop new bookings only.`
        : `Close "${slotLabel}"? There are no bookings to cancel.`,
      isWeather,
    );
    if (!handling) return;
    setCancellingSlot(true);
    try {
      const { data, error } = await supabase.functions.invoke("weather-cancel", {
        body: { slot_ids: [slot.id], business_id: businessId, reason: isWeather ? "weather conditions" : "operator cancellation", is_weather: isWeather, offer_choice: handling.offerChoice, options: handling.options },
      });
      if (error) throw error;
      const cancelled = (data as any)?.bookings_cancelled ?? 0;
      notify({ title: "Trip cancelled", message: `${cancelled} booking(s) cancelled and customers notified.${handling.offerChoice ? " Customer options enabled." : " Follow-up remains with you."}`, tone: "success" });
      setSelectedSlot(null);
      load();
    } catch (err) {
      notify({ title: "Cancellation failed", message: await describeFnError(err), tone: "error" });
    }
    setCancellingSlot(false);
  }

  async function handleCancelDay() {
    if (cancellingWeather || selectedCancelDates.length === 0) return;
    const offerChoice = cancelDayOfferChoice;
    const options = cancelDayOptions;
    const confirmed = await confirmAction({
      title: "Cancel selected days",
      message: `Close departures and cancel bookings for ${selectedCancelDates.length} selected day(s)? ${offerChoice ? `Guests can choose ${describeOptions(options)} in My Bookings.` : "Guests must contact you for refunds, vouchers or rescheduling. These options will be unavailable in My Bookings."}`,
      tone: "warning",
      confirmLabel: "Cancel days",
      cancelLabel: "Keep bookings",
    });
    if (!confirmed) return;

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
        notify({ title: "No slots found", message: "No slots for these dates.", tone: "warning" });
        setCancellingWeather(false);
        return;
      }

      // Delegate to weather-cancel edge function (atomic per-slot capacity, customer notifications)
      const { data, error } = await supabase.functions.invoke("weather-cancel", {
        body: { slot_ids: allSlotIds, business_id: businessId, reason: "weather conditions", offer_choice: offerChoice, ...(offerChoice ? { options } : {}) },
      });
      if (error) throw error;
      const cancelled = (data as any)?.bookings_cancelled ?? 0;
      const closed = (data as any)?.slots_closed ?? allSlotIds.length;

      notify({
        title: "Selected days cancelled",
        message: `${closed} slot(s) were closed and ${cancelled} booking(s) were cancelled across ${selectedCancelDates.length} day(s).`,
        tone: "success",
      });
      setShowCancelDay(false);
      setSelectedCancelDates([]);
      load();
    } catch (err: any) {
      notify({ title: "Day cancellation failed", message: await describeFnError(err), tone: "error" });
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
        notify({ title: "Nothing to reopen", message: "No closed slots for these dates.", tone: "warning" });
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
    const start = new Date(currentDate);
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
      // Look back 7 days so multi-day tours that departed before the visible
      // window still render on the days they span (covers tours up to 8 days).
      const fetchStart = new Date(start);
      fetchStart.setDate(fetchStart.getDate() - 7);
      const slotRes = await supabase.from("slots")
        .select("id, start_time, capacity_total, booked, held, status, price_per_person_override, tour_id, tours(id, name, duration_minutes)")
        .eq("business_id", businessId)
        .gte("start_time", fetchStart.toISOString())
        .lte("start_time", end.toISOString())
        .order("start_time", { ascending: true });

      if (slotRes.error) throw slotRes.error;

      const normalized = (slotRes.data || []).map((d: any) => ({
        ...d,
        tours: Array.isArray(d.tours) ? d.tours[0] : d.tours,
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

    const tz = getAdminTimezone();
    const local = utcToLocalParts(slot.start_time, tz);
    const hrs = String(local.hours).padStart(2, "0");
    const mins = String(local.mins).padStart(2, "0");

    setEditForm({
      capacity: slot.capacity_total,
      price: slot.price_per_person_override !== null ? String(slot.price_per_person_override) : "",
      status: slot.status,
      time: `${hrs}:${mins}`,
    });
  }

  async function saveSlotEdit() {
    if (!selectedSlot) return;
    const normalizedTime = normalize24HourTime(editForm.time);
    if (!normalizedTime) {
      notify({ title: "Valid time required", message: "Enter a 24-hour time such as 14:00.", tone: "warning" });
      return;
    }

    setSaving(true);

    const priceVal = editForm.price.trim() === "" ? null : Number(editForm.price);

    const [newHours, newMins] = normalizedTime.split(":").map(Number);
    const tz = getAdminTimezone();
    const originalLocal = utcToLocalParts(selectedSlot.start_time, tz);
    const originalHrs = originalLocal.hours;
    const originalMins = originalLocal.mins;
    const timeChanged = (originalHrs !== newHours || originalMins !== newMins);
    const newUtcTime = new Date(changeLocalTime(selectedSlot.start_time, tz, newHours, newMins));

    let applyToFuture = false;

    if (timeChanged) {
      const oldTimeString = `${String(originalHrs).padStart(2, "0")}:${String(originalMins).padStart(2, "0")}`;
      const newTimeString = `${String(newHours).padStart(2, "0")}:${String(newMins).padStart(2, "0")}`;

      const choice = await confirmAction({
        title: "Move matching future slots",
        message: `Would you also like to move all future ${oldTimeString} slots across all days to ${newTimeString}?`,
        tone: "info",
        confirmLabel: "Move future slots",
        altLabel: "Just this slot",
      });

      if (choice === false) { setSaving(false); return; }
      applyToFuture = choice === true;
    }

    try {
      if (timeChanged) {
        const tourId = (selectedSlot as any).tour_id || (selectedSlot.tours as any)?.id;
        const { data: conflict } = await supabase
          .from("slots")
          .select("id")
          .eq("tour_id", tourId)
          .eq("start_time", newUtcTime.toISOString())
          .neq("id", selectedSlot.id)
          .maybeSingle();

        if (conflict) {
          notify({
            title: "Time already taken",
            message: `There's already a slot at ${normalizedTime} for this tour on this date. Pick a different time.`,
            tone: "warning",
          });
          setSaving(false);
          return;
        }
      }

      // Note: status is deliberately NOT written here. Open/Close and Cancel
      // are separate, explicit actions (see closeSlot / reopenSlot /
      // cancelSlotAndRefund) so "save changes to time/capacity/price" can never
      // silently close a slot — and closing can never silently cancel bookings.
      const { error: singleUpdateError } = await supabase
        .from("slots")
        .update({
          capacity_total: Number(editForm.capacity) || selectedSlot.capacity_total,
          price_per_person_override: priceVal,
          // last_minute_at means "this override is the last-minute deal price".
          // The operator is setting the price by hand now, so the flag no longer holds.
          last_minute_at: null,
          start_time: newUtcTime.toISOString()
        })
        .eq("id", selectedSlot.id);

      if (singleUpdateError) throw singleUpdateError;

      if (applyToFuture) {
        const oldTimeString = `${String(originalHrs).padStart(2, "0")}:${String(originalMins).padStart(2, "0")}`;
        const newTimeString = `${String(newHours).padStart(2, "0")}:${String(newMins).padStart(2, "0")}`;
        const targetTourId = (selectedSlot as any).tour_id || (selectedSlot.tours as any)?.id;
        const { data: futureSlots, error: futureErr } = await supabase
          .from("slots")
          .select("id, start_time")
          .eq("tour_id", targetTourId)
          .gt("start_time", selectedSlot.start_time);

        if (futureErr) throw futureErr;

        if (futureSlots) {
          const promises = futureSlots.map(slot => {
            const slotLocal = utcToLocalParts(slot.start_time, tz);

            if (slotLocal.hours === originalHrs && slotLocal.mins === originalMins) {
              return supabase.from("slots").update({
                start_time: changeLocalTime(slot.start_time, tz, newHours, newMins)
              }).eq("id", slot.id);
            }
            return null;
          }).filter(Boolean);

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

      setSelectedSlot(null);
      load();
    } catch (err: any) {
      const msg = (err.message || "").includes("duplicate key")
        ? "A slot already exists at that time for this tour. Pick a different time or delete the existing one first."
        : "Slot could not be saved. Try again.";
      notify({ title: "Slot update failed", message: msg, tone: "error" });
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
      notify({ title: "No changes provided", message: "Enter a capacity, price or time.", tone: "warning" });
      return;
    }

    const normalizedBulkTime = bulkForm.newTime === "" ? "" : normalize24HourTime(bulkForm.newTime);
    if (normalizedBulkTime === null) {
      notify({ title: "Valid time required", message: "Enter a 24-hour time such as 14:00.", tone: "warning" });
      return;
    }

    setSavingBulk(true);

    const baseUpdates: any = {};
    if (bulkForm.capacity !== "") baseUpdates.capacity_total = Number(bulkForm.capacity);
    if (bulkForm.price !== "") {
      baseUpdates.price_per_person_override = bulkForm.price === "NULL" ? null : Number(bulkForm.price);
      baseUpdates.last_minute_at = null; // hand-set price is no longer a last-minute deal
    }

    try {
      if (normalizedBulkTime !== "") {
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
          const [newHours, newMins] = normalizedBulkTime.split(":").map(Number);
          const tz = getAdminTimezone();
          const promises = slotsToUpdate.map(slot => {
            return supabase.from("slots").update({
              ...baseUpdates,
              start_time: changeLocalTime(slot.start_time, tz, newHours, newMins)
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

  async function closeWeekdaySlots() {
    if (!isDateKey(bulkForm.startDate) || !isDateKey(bulkForm.endDate) || bulkForm.startDate > bulkForm.endDate) {
      notify({ title: "Date range required", message: "Choose a valid start date and an end date on or after it.", tone: "warning" });
      return;
    }
    setSavingBulk(true);
    let closed = 0;
    try {
      const timezone = getAdminTimezone();
      const start = new Date(Math.max(Date.now(), Date.parse(businessDayRange(bulkForm.startDate, timezone).startIso))).toISOString();
      const end = businessDayRange(bulkForm.endDate, timezone).endIso;
      const weekdays: Array<{ id: string; start_time: string }> = [];
      for (let offset = 0; ; offset += 500) {
        let query = supabase.from("slots").select("id, start_time").eq("business_id", businessId)
          .eq("status", "OPEN").gte("start_time", start).lt("start_time", end)
          .order("start_time").order("id").range(offset, offset + 499);
        if (bulkForm.tourId !== "ALL") query = query.eq("tour_id", bulkForm.tourId);
        const { data, error } = await query;
        if (error) throw error;
        for (const slot of data || []) {
          const day = new Date(businessDateKey(timezone, new Date(slot.start_time)) + "T00:00:00Z").getUTCDay();
          if (day >= 1 && day <= 5) weekdays.push(slot);
        }
        if (!data || data.length < 500) break;
      }
      if (weekdays.length === 0) {
        notify({ title: "No open weekday slots", message: "There are no future Monday–Friday slots to close for this selection.", tone: "info" });
        return;
      }
      const tourName = tours.find(tour => tour.id === bulkForm.tourId)?.name || "all tours";
      if (!await confirmAction({ title: "Close weekday slots?", message: `Close ${weekdays.length} Monday–Friday slot(s) for ${tourName} from ${bulkForm.startDate} to ${bulkForm.endDate} (${timezone})? Saturday and Sunday slots stay unchanged. Existing bookings and holds remain; no cancellation, refund or guest message is sent.`, tone: "warning", confirmLabel: "Close weekday slots" })) return;
      for (let offset = 0; offset < weekdays.length; offset += 50) {
        const batch = weekdays.slice(offset, offset + 50);
        const { data, error } = await supabase.from("slots").update({ status: "CLOSED" })
          .eq("business_id", businessId).eq("status", "OPEN").in("id", batch.map(slot => slot.id))
          .in("start_time", batch.map(slot => slot.start_time)).select("id");
        if (error) throw error;
        closed += data?.length || 0;
        if (!data || data.length !== Math.min(50, weekdays.length - offset)) throw new Error("Some slots could not be confirmed. Refresh and try again.");
      }
      notify({ title: "Weekday slots closed", message: `${closed} slots are closed to new bookings. Weekend slots and existing bookings are unchanged.`, tone: "success" });
      setShowBulkEdit(false);
      load();
    } catch (error) {
      notify({ title: "Weekday closure incomplete", message: `${closed} slots closed. ${error instanceof Error ? error.message : "Could not close the remaining slots. Refresh and try again."}`, tone: "error" });
      load();
    } finally {
      setSavingBulk(false);
    }
  }

  async function saveAddSlot() {
    if (!addForm.tourId) { notify({ title: "Tour required", message: "Please select a tour.", tone: "warning" }); return; }
    if (addForm.ranges.some((r) => !r.start || !r.end)) { notify({ title: "Date range required", message: "Every date range needs a start and an end date.", tone: "warning" }); return; }
    const normalizedAddTime = normalize24HourTime(addForm.time);
    if (!normalizedAddTime) { notify({ title: "Valid time required", message: "Enter a 24-hour time such as 14:00.", tone: "warning" }); return; }
    if (!addForm.capacity || Number(addForm.capacity) <= 0) { notify({ title: "Invalid capacity", message: "Please enter a valid capacity.", tone: "warning" }); return; }
    const priceOverride = addForm.price.trim() === "" ? null : Number(addForm.price);
    if (addPriceInvalid || (priceOverride !== null && (!Number.isFinite(priceOverride) || priceOverride < 0))) {
      notify({ title: "Invalid price override", message: "Enter a number such as 600, or leave it blank to use the tour's base price.", tone: "error" });
      return;
    }

    setSavingAdd(true);

    const [hours, mins] = normalizedAddTime.split(":").map(Number);
    const tz = getAdminTimezone();

    const rows: any[] = [];
    const seenDates = new Set<string>(); // overlapping ranges shouldn't double-count

    for (const range of addForm.ranges) {
      const start = new Date(range.start + "T00:00:00");
      const end = new Date(range.end + "T00:00:00");
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (seenDates.has(dateStr)) continue;
        seenDates.add(dateStr);
        const timeStr = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
        const localIso = `${dateStr}T${timeStr}`;
        const utcMs = zonedToUtc(localIso, tz);
        if (utcMs <= Date.now()) continue; // never create a departure in the past

        rows.push({
          tour_id: addForm.tourId,
          start_time: new Date(utcMs).toISOString(),
          capacity_total: Number(addForm.capacity),
          booked: 0,
          held: 0,
          status: "OPEN",
          price_per_person_override: priceOverride,
          business_id: businessId,
        });
      }
    }

    if (rows.length === 0) {
      notify({ title: "No matching dates", message: "No dates in the selected range matched the slot criteria.", tone: "warning" });
      setSavingAdd(false);
      return;
    }

    const { data: inserted, error } = await supabase
      .from("slots")
      .upsert(rows, { onConflict: "business_id,tour_id,start_time", ignoreDuplicates: true })
      .select("id");
    setSavingAdd(false);

    if (error) {
      notify({ title: "Could not create slots", message: "Something went wrong: " + error.message, tone: "error" });
    } else {
      const insertedCount = inserted?.length ?? 0;
      const skipped = rows.length - insertedCount;
      setShowAddSlot(false);
      setAddForm({ tourId: "", time: "06:00", ranges: [{ start: "", end: "" }], capacity: "12", price: "" });
      setAddPriceInvalid(false);
      const message = skipped > 0
        ? `${insertedCount} slot(s) created. ${skipped} already existed and were skipped (their price was not changed).`
        : `${insertedCount} slot(s) created successfully.`;
      notify({
        title: insertedCount > 0 ? "Slots created" : "No new slots",
        message,
        tone: insertedCount > 0 ? "success" : "warning",
      });
      load();
    }
  }

  function openDayAction(action: "cancel" | "reopen") {
    if (selectedCancelDates.length === 0) {
      notify({ title: "Select dates first", message: `Select calendar date headings to ${action} days.`, tone: "warning" });
      return;
    }
    if (action === "cancel") {
      setCancelDayOfferChoice(true);
      setShowCancelDay(true);
    }
    else setShowReopenDay(true);
  }

  function openAddSlot() {
    if (tours.length > 0) setAddForm(f => ({ ...f, tourId: f.tourId || tours[0].id }));
    setShowAddSlot(true);
  }

  // By default hide slots that have been zeroed-out (CLOSED status or capacity = 0)
  // so the table doesn't show orphan rows like "04:00 — 0 OPEN" for tours that
  // never actually ran at that time. Toggle to show them when managing closed slots.
  const filteredSlots = (filterTourId ? slots.filter(s => (s as any).tour_id === filterTourId || (s.tours as any)?.id === filterTourId) : slots)
    .filter(s => showClosedSlots || (Number((s as any).capacity_total || 0) > 0 && (s as any).status !== "CLOSED"));
  const filterTourName = filterTourId ? tours.find(t => t.id === filterTourId)?.name : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 md:flex-wrap md:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div>
            <h2 className="font-display text-[24px] md:text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}><span className="md:hidden">Slots</span><span className="hidden md:inline">Slot Management</span></h2>
          </div>
          {filterTourName && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "var(--ck-accent-soft)", color: "var(--ck-accent)" }}>
              {filterTourName}
              <button onClick={() => setFilterTourId(null)} className="ml-0.5 font-bold" style={{ color: "var(--ck-accent)" }}>×</button>
            </span>
          )}
          <label className="ml-2 hidden items-center gap-1.5 text-xs font-medium cursor-pointer select-none md:inline-flex" style={{ color: "var(--ck-text)" }}>
            <input
              type="checkbox"
              checked={showClosedSlots}
              onChange={(e) => setShowClosedSlots(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 accent-[var(--ck-accent)]"
            />
            Show closed / 0-capacity
          </label>
        </div>
        <details ref={mobileMenuRef} className="relative shrink-0 md:hidden">
          <summary aria-label="Slot management options" className="ui-btn ui-btn-ghost min-h-11 min-w-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <List size={22} aria-hidden="true" />
          </summary>
          <div className="absolute right-0 z-40 mt-2 max-h-[60dvh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border p-1.5 shadow-lg" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border-subtle)" }} onClick={event => {
            if (!(event.target as HTMLElement).closest("button")) return;
            mobileMenuRef.current?.removeAttribute("open");
            mobileMenuRef.current?.querySelector("summary")?.focus();
          }}>
            <button type="button" onClick={openAddSlot} className="ui-btn ui-btn-ghost min-h-11 w-full !justify-start">Add slot</button>
            <button type="button" onClick={() => setBulkGenOpen(true)} className="ui-btn ui-btn-ghost min-h-11 w-full !justify-start">Generate slots</button>
            <button type="button" onClick={() => setShowBulkEdit(true)} className="ui-btn ui-btn-ghost min-h-11 w-full !justify-start">Bulk edit</button>
            <button type="button" onClick={() => openDayAction("cancel")} className="ui-btn ui-btn-ghost min-h-11 w-full !justify-start" style={{ color: "var(--ck-danger)" }}>Cancel days{selectedCancelDates.length > 0 ? ` (${selectedCancelDates.length})` : ""}</button>
            <button type="button" onClick={() => openDayAction("reopen")} className="ui-btn ui-btn-ghost min-h-11 w-full !justify-start">Reopen days{selectedCancelDates.length > 0 ? ` (${selectedCancelDates.length})` : ""}</button>
            <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-3 border-t px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border-subtle)" }}>
              <input type="checkbox" checked={showClosedSlots} onChange={event => setShowClosedSlots(event.target.checked)} className="h-4 w-4 accent-[var(--ck-accent)]" />
              Show closed / 0-capacity
            </label>
          </div>
        </details>
        <div className="hidden gap-2 md:flex md:w-auto md:flex-wrap md:justify-end">
          <button
            onClick={() => openDayAction("cancel")}
            className={`ui-btn ${selectedCancelDates.length > 0 ? "ui-btn-danger" : "ui-btn-ghost"}`}
          >
            Cancel Day(s) {selectedCancelDates.length > 0 ? `(${selectedCancelDates.length})` : ""}
          </button>
          <button
            onClick={() => openDayAction("reopen")}
            className={`ui-btn ${selectedCancelDates.length > 0 ? "ui-btn-soft" : "ui-btn-ghost"}`}
          >
            Reopen Day(s) {selectedCancelDates.length > 0 ? `(${selectedCancelDates.length})` : ""}
          </button>
          <button
            onClick={openAddSlot}
            className="ui-btn ui-btn-primary"
          >
            Add Slot
          </button>
          <button
            onClick={() => setBulkGenOpen(true)}
            className="ui-btn ui-btn-soft"
          >
            Bulk Generate
          </button>
          <button
            onClick={() => setShowBulkEdit(true)}
            className="ui-btn ui-btn-ghost"
          >
            Bulk Edit
          </button>
        </div>
      </div>

      <div className="anim-fade-up anim-d1">
        <CalendarHeader
          currentDate={currentDate}
          viewMode={viewMode}
          onDateChange={setCurrentDate}
          onViewModeChange={setViewMode}
          monthViewOpen={monthViewOpen}
          onToggleMonthView={() => setMonthViewOpen((v) => !v)}
        />
      </div>

      {monthViewOpen && (
        <BookingsMonthCalendar
          businessId={businessId}
          tours={tours}
          selectedDate={currentDate}
          onSelectDate={setCurrentDate}
          onClose={() => setMonthViewOpen(false)}
        />
      )}

      <div className="anim-fade-up anim-d2">
      {loading ? (
        <div className="space-y-4"><div className="ui-skeleton h-[48px] !rounded-xl" /><div className="ui-skeleton h-[420px] !rounded-2xl" /></div>
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
      </div>

      {selectedSlot && (() => {
        const availability = selectedSlot.capacity_total - selectedSlot.booked - (selectedSlot.held || 0);
        const departed = Date.parse(selectedSlot.start_time) <= Date.now();
        const open = selectedSlot.status === "OPEN" && !departed;
        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: "rgba(10,18,13,0.55)", backdropFilter: "blur(2px)" }}>
            <div className="ui-card w-full max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-6 sm:max-w-md !rounded-t-2xl sm:!rounded-2xl">
            <h3 className="mb-1 text-xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Edit Slot</h3>
            <p className="mb-4 text-sm" style={{ color: "var(--ck-text-muted)" }}>
              {new Date(selectedSlot.start_time).toLocaleString("en-ZA", {
                weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone()
              })}: {selectedSlot.tours?.name}
            </p>

            <div className="mb-4 rounded-xl p-3 text-sm" style={{ background: "var(--ck-surface-sunken)", border: "1px solid var(--ck-border-subtle)" }}>
              <div className="ui-mono-label !text-[10px]">Available</div>
              <div className="font-display mt-1 text-2xl font-semibold leading-none tabular-nums" style={{ color: availability > 0 ? "var(--ck-success)" : "var(--ck-text-muted)" }}>{availability}</div>
            </div>

            <div className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
              style={{ background: open ? "var(--ck-success-soft, #e7f5ec)" : "var(--ck-surface-sunken)", color: open ? "var(--ck-success)" : "var(--ck-text-muted)" }}>
              {departed ? "○ Departed: no longer taking bookings" : open ? "● Open: accepting bookings" : "○ Closed: not accepting new bookings"}
            </div>

            <div className="space-y-4">
              <label className="block text-sm text-gray-600">
                Time
                <span className="mb-1 block text-xs text-gray-400">24-hour time, for example 14:00.</span>
                <TimeInput value={editForm.time} onChange={(time) => setEditForm({ ...editForm, time })} />
              </label>

              <label className="block text-sm text-gray-600">
                Max Capacity
                <input
                  type="number"
                  min="0"
                  value={editForm.capacity}
                  onChange={(e) => setEditForm({ ...editForm, capacity: Number(e.target.value) })}
                  className="ui-control mt-1 w-full"
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
                  className="ui-control mt-1 w-full"
                />
              </label>
            </div>

            {/* Save time/capacity/price changes — never affects status/bookings */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button onClick={() => setSelectedSlot(null)} className="ui-btn ui-btn-ghost">Close window</button>
              <button data-demo-action="slot.save" onClick={saveSlotEdit} disabled={saving} className="ui-btn ui-btn-primary disabled:opacity-50">
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>

            {/* Availability vs Cancellation — two clearly separated actions */}
            <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
              <p className="ui-mono-label !text-[10px] mb-2">Manage this slot</p>
              <div className="space-y-2">
                {departed ? null : selectedSlot.status === "OPEN" ? (
                  <button data-demo-action="slot.close"
                    onClick={() => closeSlot(selectedSlot)}
                    disabled={slotStatusSaving || cancellingSlot}
                    className="ui-btn ui-btn-ghost w-full justify-start disabled:opacity-50"
                    style={{ borderColor: "var(--ck-border-strong)" }}
                  >
                    <span className="font-semibold">Close slot</span>
                  </button>
                ) : (
                  <button data-demo-action="slot.reopen"
                    onClick={() => reopenSlot(selectedSlot)}
                    disabled={slotStatusSaving || cancellingSlot}
                    className="ui-btn ui-btn-ghost w-full justify-start disabled:opacity-50"
                    style={{ borderColor: "var(--ck-border-strong)" }}
                  >
                    <span className="font-semibold">Reopen slot</span>
                  </button>
                )}
                <button data-demo-action="slot.cancel"
                  onClick={() => cancelSlotAndRefund(selectedSlot)}
                  disabled={cancellingSlot || slotStatusSaving}
                  className="ui-btn ui-btn-danger w-full justify-start disabled:opacity-50"
                >
                  <span className="font-semibold">{cancellingSlot ? "Cancelling…" : "Cancel & notify guests"}</span>
                </button>
                <button data-demo-action="slot.weather"
                  onClick={() => cancelSlotAndRefund(selectedSlot, true)}
                  disabled={cancellingSlot || slotStatusSaving}
                  className="ui-btn ui-btn-danger w-full justify-start disabled:opacity-50"
                >
                  <span className="font-semibold">{cancellingSlot ? "Cancelling…" : "Weather cancel"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/* BULK EDIT MODAL */}
      {showBulkEdit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: "rgba(10,18,13,0.55)", backdropFilter: "blur(2px)" }}>
          <div className="ui-card w-full max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-6 sm:max-w-md !rounded-t-2xl sm:!rounded-2xl" role="dialog" aria-modal="true" aria-label="Bulk Edit Slots">
            <h3 className="mb-1 text-xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Bulk Edit Slots</h3>
            <p className="mb-4 text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Update departures for this tour and date range.
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
                  className="ui-control mt-1 w-full"
                >
                  <option value="ALL">All Tours</option>
                  {tours.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              <label className="block text-sm text-gray-600">
                New Time
                <span className="block text-xs text-gray-400 mb-1">Blank keeps current times. Use 24-hour time, e.g. 14:00.</span>
                <TimeInput
                  name="bulk_new_time"
                  value={bulkForm.newTime}
                  onChange={(newTime) => setBulkForm({ ...bulkForm, newTime })}
                />
              </label>

              <label className="block text-sm text-gray-600">
                New Max Capacity
                <span className="block text-xs text-gray-400 mb-1">Leave blank to keep existing capacities.</span>
                <input
                  name="bulk_capacity"
                  type="number"
                  min="0"
                  placeholder="e.g. 24"
                  value={bulkForm.capacity}
                  onChange={(e) => setBulkForm({ ...bulkForm, capacity: e.target.value })}
                  className="ui-control mt-1 w-full"
                />
              </label>

              <label className="block text-sm text-gray-600">
                New Base Price (ZAR)
                <span className="block text-xs text-gray-400 mb-1">Blank keeps current prices. Enter NULL for the base rate.</span>
                <input
                  name="bulk_price"
                  type="text"
                  placeholder="e.g. 650 or NULL"
                  value={bulkForm.price}
                  onChange={(e) => setBulkForm({ ...bulkForm, price: e.target.value })}
                  className="ui-control mt-1 w-full"
                />
              </label>
            </div>

            <section className="mt-5 space-y-2 border-t border-[var(--ck-border-subtle)] pt-4" aria-label="Weekend-only availability">
              <h4 className="font-semibold text-[var(--ck-text-strong)]">Make existing slots weekends only</h4>
              <p className="text-sm text-[var(--ck-text-muted)]">Close future weekdays in this range. Weekends, bookings and holds stay as they are. Ignores capacity, price and time fields.</p>
              <button type="button" data-demo-action="slot.close-weekdays" onClick={closeWeekdaySlots} disabled={savingBulk || !bulkForm.startDate || !bulkForm.endDate} className="ui-btn ui-btn-ghost w-full disabled:opacity-50">{savingBulk ? "Please wait..." : "Close weekday slots"}</button>
            </section>

            <div className="mt-6 grid grid-cols-1 gap-2 sm:flex sm:justify-end">
              <button
                onClick={() => setShowBulkEdit(false)}
                className="ui-btn ui-btn-ghost"
              >
                Cancel
              </button>
              <button data-demo-action="slot.bulk"
                onClick={saveBulkEdit}
                data-help-submit=""
                disabled={savingBulk || !bulkForm.startDate || !bulkForm.endDate}
                className="ui-btn ui-btn-primary disabled:opacity-50"
              >
                {savingBulk ? "Applying..." : "Apply Bulk Update"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD SLOT MODAL */}
      {showAddSlot && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ background: "rgba(10,18,13,0.55)", backdropFilter: "blur(2px)" }}>
          <div className="ui-card w-full max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-6 sm:max-w-md !rounded-t-2xl sm:!rounded-2xl" role="dialog" aria-modal="true" aria-label="Add New Slots">
            <h3 className="mb-1 text-xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Add New Slots</h3>
            <p className="mb-4 text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Create departures across a date range.
            </p>

            <div className="space-y-4">
              <label className="block text-sm text-gray-600">
                Tour
                <select
                  value={addForm.tourId}
                  onChange={(e) => setAddForm({ ...addForm, tourId: e.target.value })}
                  className="ui-control mt-1 w-full"
                >
                  <option value="">Select a tour...</option>
                  {tours.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              <label className="block text-sm text-gray-600">
                Time (24-hour SA time)
                <TimeInput
                  name="slot_time"
                  value={addForm.time}
                  onChange={(time) => setAddForm({ ...addForm, time })}
                />
              </label>

              <div className="space-y-3">
                {addForm.ranges.map((range, idx) => (
                  <div key={idx} className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_28px] sm:items-end">
                    <label className="block text-sm text-gray-600">
                      {idx === 0 ? "Start Date" : `Range ${idx + 1} start`}
                      <div className="mt-1">
                        <DatePicker position="top" min={today} value={range.start} onChange={(val) => setAddForm({ ...addForm, ranges: addForm.ranges.map((r, i) => i === idx ? { ...r, start: val } : r) })} className="py-2.5 w-full border-gray-300" />
                      </div>
                    </label>
                    <label className="block text-sm text-gray-600">
                      {idx === 0 ? "End Date" : `Range ${idx + 1} end`}
                      <div className="mt-1">
                        <DatePicker position="top" min={range.start || today} value={range.end} onChange={(val) => setAddForm({ ...addForm, ranges: addForm.ranges.map((r, i) => i === idx ? { ...r, end: val } : r) })} className="py-2.5 w-full border-gray-300" />
                      </div>
                    </label>
                    {idx > 0 ? (
                      <button
                        onClick={() => setAddForm({ ...addForm, ranges: addForm.ranges.filter((_, i) => i !== idx) })}
                        className="pb-2.5 text-[15px] text-[var(--ck-danger)]"
                        title="Remove this date range"
                        aria-label={`Remove date range ${idx + 1}`}
                      >
                        &times;
                      </button>
                    ) : <span className="hidden sm:block" />}
                  </div>
                ))}
                <button
                  onClick={() => setAddForm({ ...addForm, ranges: [...addForm.ranges, { start: "", end: "" }] })}
                  className="ui-btn !py-1.5 text-[12px]"
                >
                  Add date range
                </button>
              </div>

              <label className="block text-sm text-gray-600">
                Max Capacity
                <input
                  name="slot_capacity"
                  type="number"
                  min="1"
                  value={addForm.capacity}
                  onChange={(e) => setAddForm({ ...addForm, capacity: e.target.value })}
                  className="ui-control mt-1 w-full"
                />
              </label>

              <label className="block text-sm text-gray-600">
                Price Override (ZAR)
                <span className="block text-xs text-gray-400 mb-1">Blank uses the tour&apos;s base price.</span>
                <input
                  name="slot_price"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 600"
                  value={addForm.price}
                  onChange={(e) => { setAddPriceInvalid(e.currentTarget.validity.badInput); setAddForm({ ...addForm, price: e.target.value }); }}
                  aria-invalid={addPriceInvalid}
                  className="ui-control mt-1 w-full"
                />
                {addPriceInvalid && <span className="mt-1 block text-xs" style={{ color: "var(--ck-danger)" }}>Enter a number such as 600 or 600.50.</span>}
              </label>
            </div>

            <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 px-6 pb-6 pt-3" style={{ background: "var(--ck-surface-warm)" }}>
              {(!addForm.tourId || addForm.ranges.some((r) => !r.start || !r.end)) && (
                <p className="mb-2 text-xs" style={{ color: "var(--ck-text-muted)" }}>Choose a tour and fill in every date range to create slots.</p>
              )}
              <div className="grid grid-cols-1 gap-2 sm:flex sm:justify-end">
                <button
                  onClick={() => setShowAddSlot(false)}
                  className="ui-btn ui-btn-ghost"
                >
                  Cancel
                </button>
                <button data-demo-action="slot.create"
                  onClick={saveAddSlot}
                  data-help-submit=""
                  disabled={savingAdd || !addForm.tourId || addForm.ranges.some((r) => !r.start || !r.end)}
                  className="ui-btn ui-btn-primary disabled:opacity-50"
                >
                  {savingAdd ? "Creating..." : "Create Slots"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL DAY MODAL */}
      {showCancelDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,18,13,0.55)", backdropFilter: "blur(2px)" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="cancel-day-title" className="ui-card max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto overscroll-contain p-5 sm:p-6">
            <h3 id="cancel-day-title" className="mb-1 text-xl font-bold" style={{ color: "var(--ck-danger)" }}>Cancel days ({selectedCancelDates.length})</h3>
            <p className="mb-4 text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Close departures and cancel active bookings for bad weather on:
            </p>

            <div className="mb-4 max-h-[30vh] space-y-2 overflow-y-auto rounded-lg p-3" style={{ background: "var(--ck-surface-sunken)", border: "1px solid var(--ck-border-subtle)" }}>
              <ul className="list-disc pl-5">
                {selectedCancelDates.map((date) => (
                  <li key={date} className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</li>
                ))}
              </ul>
            </div>

            <fieldset disabled={cancellingWeather} className="space-y-2">
              <legend className="mb-2 text-sm font-semibold">After cancellation</legend>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                <input type="radio" name="cancel-day-handling" value="guests" checked={cancelDayOfferChoice} onChange={() => setCancelDayOfferChoice(true)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--ck-accent)]" />
                <span className="min-w-0 text-sm"><span className="block font-semibold">Guests choose</span><span style={{ color: "var(--ck-text-muted)" }}>From the options selected below, in My Bookings.</span></span>
              </label>
              {cancelDayOfferChoice && (
                <div className="pb-2 pl-7">
                  <OptionToggles label="Options to offer" options={CANCEL_OPTIONS} picked={cancelDayOptions} onChange={setCancelDayOptions} />
                </div>
              )}
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                <input type="radio" name="cancel-day-handling" value="operator" checked={!cancelDayOfferChoice} onChange={() => setCancelDayOfferChoice(false)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--ck-accent)]" />
                <span className="min-w-0 text-sm"><span className="block font-semibold">Contact operator</span><span style={{ color: "var(--ck-text-muted)" }}>You handle refunds, vouchers and rescheduling. No guest choices in My Bookings.</span></span>
              </label>
            </fieldset>

            <div className="mt-6 grid grid-cols-1 gap-2 sm:flex sm:justify-end">
              <button
                onClick={() => setShowCancelDay(false)}
                className="ui-btn ui-btn-ghost"
              >
                Go Back
              </button>
              <button data-demo-action="slot.cancel-days"
                onClick={handleCancelDay}
                disabled={cancellingWeather || selectedCancelDates.length === 0 || (cancelDayOfferChoice && cancelDayOptions.length === 0)}
                className="ui-btn disabled:opacity-50"
                style={{ background: "var(--ck-danger)", color: "#fff" }}
              >
                {cancellingWeather ? "Cancelling…" : "Cancel days"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkGenOpen && <BulkSlotWizard tours={tours} onClose={() => { setBulkGenOpen(false); load(); }} />}

      {/* REOPEN DAY MODAL */}
      {showReopenDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,18,13,0.55)", backdropFilter: "blur(2px)" }}>
          <div className="ui-card w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-6" role="dialog" aria-modal="true" aria-label="Reopen days">
            <h3 className="mb-1 text-xl font-bold" style={{ color: "var(--ck-accent)" }}>Reopen ({selectedCancelDates.length}) Day(s)</h3>
            <p className="mb-4 text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Reopen closed departures for bookings on:
            </p>

            <div className="mb-4 max-h-[30vh] space-y-2 overflow-y-auto rounded-lg p-3" style={{ background: "var(--ck-surface-sunken)", border: "1px solid var(--ck-border-subtle)" }}>
              <ul className="list-disc pl-5">
                {selectedCancelDates.map((date) => (
                  <li key={date} className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</li>
                ))}
              </ul>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-2 sm:flex sm:justify-end">
              <button
                onClick={() => setShowReopenDay(false)}
                className="ui-btn ui-btn-ghost"
              >
                Cancel
              </button>
              <button data-demo-action="slot.reopen-days"
                onClick={handleReopenDay}
                disabled={reopeningDay || selectedCancelDates.length === 0}
                className="ui-btn ui-btn-primary disabled:opacity-50"
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
