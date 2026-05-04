"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { confirmAction, notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { listAvailableSlots } from "../lib/slot-availability";
import { PaperPlaneTilt, DownloadSimple, ArrowSquareOut, SpinnerGap, CheckCircle, XCircle, Spinner } from "@phosphor-icons/react";
import { cancelBookingAction, refundBookingAction, markPaidAction, checkInAction, type ActionResult } from "../lib/booking-actions";
import { DatePicker } from "../../components/DatePicker";
import { MonthPicker } from "../../components/MonthPicker";
import { useBusinessContext } from "../../components/BusinessContext";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: getAdminTimezone(),
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: getAdminTimezone(),
  });
}

function fmtCurrency(n: number) {
  return "R" + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: getAdminTimezone(),
  }).format(new Date(iso));
}

function toDateInput(iso: string) {
  return dateKey(iso);
}

function normalizePhone(phone: string): string {
  let clean = phone.replace(/[\s\-\+\(\)]/g, "");
  if (clean.startsWith("0")) {
    clean = "27" + clean.substring(1);
  }
  return clean;
}

function dayRange(dateInput: string) {
  const day = new Date(`${dateInput}T00:00:00`);
  const next = new Date(day);
  next.setDate(next.getDate() + 1);
  return { startIso: day.toISOString(), endIso: next.toISOString() };
}

function isPaid(status: string) {
  return ["PAID", "CONFIRMED", "COMPLETED"].includes(status);
}

type TourRel = { id?: string; name?: string } | null;
type SlotRel = {
  id?: string;
  start_time?: string;
  tour_id?: string;
  capacity_total?: number;
  booked?: number;
  status?: string;
} | null;

interface Booking {
  id: string;
  slot_id: string | null;
  customer_name: string;
  phone: string;
  email: string;
  qty: number;
  total_amount: number;
  status: string;
  source: string;
  external_ref: string | null;
  refund_status: string | null;
  refund_amount: number | null;
  yoco_checkout_id: string | null;
  payment_deadline: string | null;
  waiver_status: string | null;
  custom_fields: Record<string, string> | null;
  tours: TourRel;
  slots: SlotRel;
}

interface SlotGroup {
  timeLabel: string;
  sortKey: string;
  bookings: Booking[];
  totalPax: number;
  totalPrice: number;
  totalPaid: number;
  totalDue: number;
}

interface DayGroup {
  dateLabel: string;
  sortKey: string;
  slots: SlotGroup[];
  totalPax: number;
  totalPrice: number;
  totalPaid: number;
  totalDue: number;
}

interface RebookSlot {
  id: string;
  start_time: string;
  capacity_total: number;
  booked: number;
  held?: number;
  status: string;
  tour_name?: string | null;
  available_capacity: number;
  price_per_person_override?: number | null;
  base_price_per_person?: number | null;
}

interface EditForm {
  customer_name: string;
  phone: string;
  email: string;
  qty: string;
  total_amount: string;
  status: string;
}

const STATUS_OPTIONS = ["PENDING", "PENDING PAYMENT", "HELD", "CONFIRMED", "PAID", "COMPLETED", "CANCELLED"];

export default function Bookings() {
  const { businessId, role } = useBusinessContext();
  const router = useRouter();
  const isPrivilegedRole = role === "MAIN_ADMIN" || role === "SUPER_ADMIN";
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBookingId, setActionBookingId] = useState<string | null>(null);
  const [cancellingWeatherId, setCancellingWeatherId] = useState<string | null>(null);
  const [resendingInvoiceId, setResendingInvoiceId] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [rangeEnd, setRangeEnd] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    d.setHours(23, 59, 59, 999);
    return d;
  });
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set());
  const [expandAllDays, setExpandAllDays] = useState<Set<string>>(new Set());
  const [editBooking, setEditBooking] = useState<Booking | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    customer_name: "",
    phone: "",
    email: "",
    qty: "1",
    total_amount: "0.00",
    status: "PENDING",
  });
  const [rebookBooking, setRebookBooking] = useState<Booking | null>(null);
  const [rebookDate, setRebookDate] = useState("");
  const [rebookSlots, setRebookSlots] = useState<RebookSlot[]>([]);
  const [rebookSlotId, setRebookSlotId] = useState("");
  const [rebookExcessAction, setRebookExcessAction] = useState<"REFUND" | "VOUCHER">("REFUND");
  const [loadingRebookSlots, setLoadingRebookSlots] = useState(false);
  const [paymentLinkBookingId, setPaymentLinkBookingId] = useState<string | null>(null);
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null);
  const [paymentLinkRef, setPaymentLinkRef] = useState<string>("");
  const [refundDialog, setRefundDialog] = useState<{ booking: Booking; amount: string } | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [waDialog, setWaDialog] = useState<{ phone: string; name: string } | null>(null);
  const [waMessage, setWaMessage] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [quickResendingId, setQuickResendingId] = useState<string | null>(null);

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  type BulkAction = "cancel" | "refund" | "markpaid" | "checkin";
  type ProgressEvent = { id: string; name: string; status: "pending" | "ok" | "error"; error?: string };
  const [bulkProgress, setBulkProgress] = useState<ProgressEvent[] | null>(null);
  const [bulkActionInFlight, setBulkActionInFlight] = useState<BulkAction | null>(null);

  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function selectAllVisible(ids: string[]) {
    setSelected(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
  }
  function clearSelection() { setSelected(new Set()); }

  const bookingsById = useMemo(() => {
    var map: Record<string, Booking> = {};
    for (var b of bookings) map[b.id] = b;
    return map;
  }, [bookings]);

  async function runBulk(action: BulkAction) {
    var ids = Array.from(selected);
    if (ids.length === 0) return;

    var confirmText: Record<BulkAction, string> = {
      cancel: "Cancel " + ids.length + " booking(s)? Each customer will be notified and refund calculated per the cancellation policy.",
      refund: "Refund " + ids.length + " booking(s)? Each will be processed via Yoco or marked as manual refund.",
      markpaid: "Mark " + ids.length + " booking(s) as paid (EFT)?",
      checkin: "Check in " + ids.length + " guest(s)?",
    };
    if (!await confirmAction({ title: "Bulk " + action, message: confirmText[action], tone: "warning", confirmLabel: "Proceed" })) return;

    var reason = "operator-cancel";
    var weather = false;
    if (action === "cancel") {
      weather = confirm("Is this a weather cancel? (Weather cancels override the policy and refund 100%.)");
      var prompted = prompt("Brief reason (visible in audit log):", weather ? "weather" : "operator-cancel");
      reason = prompted || "operator-cancel";
    }

    setBulkActionInFlight(action);
    var init: ProgressEvent[] = ids.map(id => ({ id, name: bookingsById[id]?.customer_name || id.slice(0, 8), status: "pending" as const }));
    setBulkProgress(init);

    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var result: ActionResult;
      switch (action) {
        case "cancel":   result = await cancelBookingAction(id, { reason, weather }); break;
        case "refund":   result = await refundBookingAction(id); break;
        case "markpaid": result = await markPaidAction(id); break;
        case "checkin":  result = await checkInAction(id); break;
      }
      setBulkProgress(prev =>
        prev?.map(e => e.id === id ? { ...e, status: result.ok ? "ok" : "error", error: result.error } : e) ?? null,
      );
      if (i < ids.length - 1) await new Promise(r => setTimeout(r, 120));
    }

    setBulkActionInFlight(null);

    // Log bulk summary
    try {
      var final = init.map(e => {
        var match = bulkProgress?.find(p => p.id === e.id);
        return match || e;
      });
      await supabase.from("logs").insert({
        business_id: businessId,
        event: "bulk_action_" + action,
        payload: {
          bulk: true,
          action,
          booking_ids: ids,
          succeeded: ids.filter((_, idx) => init[idx]?.status !== "error"),
          total: ids.length,
          reason: action === "cancel" ? reason : undefined,
          weather: action === "cancel" ? weather : undefined,
        },
      });
    } catch { /* audit log failure should not block */ }

    await loadBookings();
  }

  async function loadBookings() {
    if (!businessId) return;
    console.log("[BOOKINGS] loadBookings started", { businessId, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString() });
    setLoading(true);

    // Step 1: Get slot IDs in the date range
    const { data: slotRows, error: slotErr } = await supabase
      .from("slots")
      .select("id")
      .eq("business_id", businessId)
      .gte("start_time", rangeStart.toISOString())
      .lte("start_time", rangeEnd.toISOString());

    if (slotErr) {
      console.error("[BOOKINGS] loadBookings slot fetch error:", slotErr.message, slotErr.code, slotErr.details);
    }

    const slotIds = (slotRows || []).map((s: { id: string }) => s.id);

    // Step 2: Fetch bookings matching those slots
    let allBookings: any[] = [];

    if (slotIds.length > 0) {
      // Supabase .in() has a limit — batch if needed
      const BATCH = 500;
      for (let i = 0; i < slotIds.length; i += BATCH) {
        const batch = slotIds.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from("bookings")
          .select("id, slot_id, customer_name, phone, email, qty, total_amount, status, source, external_ref, refund_status, refund_amount, yoco_checkout_id, payment_deadline, waiver_status, custom_fields, tours(id,name), slots(id,start_time,tour_id,capacity_total,booked,status)")
          .eq("business_id", businessId)
          .in("slot_id", batch)
          .order("created_at", { ascending: true })
          .limit(2000);
        if (error) {
          console.error("[BOOKINGS] loadBookings batch fetch error:", error.message, error.code, error.details, error.hint);
        }
        if (data) allBookings.push(...data);
      }
    }

    // Step 3: Also fetch unslotted bookings (created in range, no slot assigned)
    const { data: unslotted } = await supabase
      .from("bookings")
      .select("id, slot_id, customer_name, phone, email, qty, total_amount, status, source, external_ref, refund_status, refund_amount, yoco_checkout_id, payment_deadline, waiver_status, custom_fields, tours(id,name), slots(id,start_time,tour_id,capacity_total,booked,status)")
      .eq("business_id", businessId)
      .is("slot_id", null)
      .in("status", ["PAID", "CONFIRMED", "HELD", "PENDING", "PENDING PAYMENT"])
      .gte("created_at", rangeStart.toISOString())
      .order("created_at", { ascending: true })
      .limit(200);
    if (unslotted) allBookings.push(...unslotted);

    // Deduplicate
    const seen = new Set<string>();
    const deduped = allBookings.filter((b: any) => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    });

    const normalized = (deduped as Array<Booking & { tours: unknown; slots: unknown }>)
      .map((b) => ({
        ...b,
        tours: (Array.isArray(b.tours) ? b.tours[0] || null : b.tours) as TourRel,
        slots: (Array.isArray(b.slots) ? b.slots[0] || null : b.slots) as SlotRel,
      }));

    console.log("[BOOKINGS] loadBookings complete", { totalBookings: normalized.length, slotCount: slotIds.length });
    setBookings(normalized as Booking[]);
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      loadBookings();
    }, 0);
    return () => clearTimeout(t);
  }, [rangeStart, rangeEnd, businessId]);

  // Auto-refresh when a booking status changes (e.g. payment received)
  useEffect(() => {
    supabase.removeChannel(supabase.channel("bookings-status"));
    const channel = supabase
      .channel("bookings-status")
      .on(
        "postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "bookings" },
        () => loadBookings()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rangeStart, rangeEnd]);

  const STATUS_FILTER_MAP: Record<string, string[]> = {
    ALL: [],
    PENDING: ["PENDING", "PENDING PAYMENT", "HELD"],
    PAID: ["PAID"],
    CONFIRMED: ["CONFIRMED"],
    COMPLETED: ["COMPLETED"],
    CANCELLED: ["CANCELLED"],
  };

  const filteredBookings = useMemo(() => {
    if (statusFilter === "ALL") return bookings;
    const allowed = STATUS_FILTER_MAP[statusFilter] || [];
    return bookings.filter((b) => allowed.includes(b.status));
  }, [bookings, statusFilter]);

  const allVisibleIds = useMemo(() => filteredBookings.map(b => b.id), [filteredBookings]);

  const selectionAllPaid = useMemo(() => {
    if (selected.size === 0) return false;
    return Array.from(selected).every(id => bookingsById[id] && isPaid(bookingsById[id].status));
  }, [selected, bookingsById]);

  const selectionAllUnpaid = useMemo(() => {
    if (selected.size === 0) return false;
    return Array.from(selected).every(id => {
      var b = bookingsById[id];
      return b && ["PENDING", "PENDING PAYMENT", "HELD"].includes(b.status);
    });
  }, [selected, bookingsById]);

  const selectionNoneCancelled = useMemo(() => {
    if (selected.size === 0) return false;
    return Array.from(selected).every(id => bookingsById[id]?.status !== "CANCELLED");
  }, [selected, bookingsById]);

  const dayGroups: DayGroup[] = useMemo(() => {
    const dayMap = new Map<string, Map<string, Booking[]>>();
    for (const b of filteredBookings) {
      const startTime = b.slots?.start_time;
      const dk = startTime ? dateKey(startTime) : "9999-99-99";
      const tk = startTime ? fmtTime(startTime) : "Unscheduled";
      if (!dayMap.has(dk)) dayMap.set(dk, new Map());
      const slotMap = dayMap.get(dk)!;
      if (!slotMap.has(tk)) slotMap.set(tk, []);
      slotMap.get(tk)!.push(b);
    }

    const days: DayGroup[] = [];
    for (const [dk, slotMap] of dayMap) {
      const slots: SlotGroup[] = [];
      for (const [tk, bks] of slotMap) {
        const activeBks = bks.filter((b) => b.status !== "CANCELLED");
        const totalPax = activeBks.reduce((s, b) => s + Number(b.qty || 0), 0);
        const totalPrice = activeBks.reduce((s, b) => s + Number(b.total_amount || 0), 0);
        const totalPaid = activeBks.filter((b) => isPaid(b.status)).reduce((s, b) => s + Number(b.total_amount || 0), 0);
        slots.push({
          timeLabel: tk,
          sortKey: tk,
          bookings: bks,
          totalPax,
          totalPrice,
          totalPaid,
          totalDue: totalPrice - totalPaid,
        });
      }
      slots.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      const totalPax = slots.reduce((s, sl) => s + sl.totalPax, 0);
      const totalPrice = slots.reduce((s, sl) => s + sl.totalPrice, 0);
      const totalPaid = slots.reduce((s, sl) => s + sl.totalPaid, 0);
      const first = filteredBookings.find((b) => b.slots?.start_time && dateKey(b.slots.start_time) === dk);
      days.push({
        dateLabel: first?.slots?.start_time ? fmtDate(first.slots.start_time) : dk,
        sortKey: dk,
        slots,
        totalPax,
        totalPrice,
        totalPaid,
        totalDue: totalPrice - totalPaid,
      });
    }
    days.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return days;
  }, [filteredBookings]);

  function toggleSlot(key: string) {
    setExpandedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleExpandAll(dayKey: string, slotKeys: string[]) {
    setExpandAllDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) {
        next.delete(dayKey);
        setExpandedSlots((prevSlots) => {
          const n = new Set(prevSlots);
          slotKeys.forEach((k) => n.delete(k));
          return n;
        });
      } else {
        next.add(dayKey);
        setExpandedSlots((prevSlots) => {
          const n = new Set(prevSlots);
          slotKeys.forEach((k) => n.add(k));
          return n;
        });
      }
      return next;
    });
  }

  function shiftRange(days: number) {
    setRangeStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + days);
      return d;
    });
    setRangeEnd((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + days);
      return d;
    });
  }

  function handleMonthChange(value: string) {
    if (!value) return;
    console.log("[BOOKINGS] handleMonthChange", { value });
    const [year, month] = value.split("-");

    // Set to 1st of the selected month
    const start = new Date(Number(year), Number(month) - 1, 1);
    start.setHours(0, 0, 0, 0);
    setRangeStart(start);

    // Set to last millisecond of the selected month
    const end = new Date(Number(year), Number(month), 0);
    end.setHours(23, 59, 59, 999);
    setRangeEnd(end);
  }

  async function resendInvoiceForBooking(bookingId: string) {
    console.log("[BOOKINGS] resendInvoiceForBooking", { bookingId });
    setResendingInvoiceId(bookingId);
    try {
      // Find the booking in our local state
      const b = bookings.find((bk) => bk.id === bookingId);
      if (!b || !b.email) {
        notify({ title: "Missing email", message: "No email address found for this booking.", tone: "warning" });
        setResendingInvoiceId(null);
        return;
      }
      const ref = b.id.substring(0, 8).toUpperCase();
      const tourName = b.tours?.name || "Kayak Booking";
      const startTime = b.slots?.start_time ? fmtDate(b.slots.start_time) : "-";
      const total = Number(b.total_amount || 0);
      const unitPrice = b.qty > 0 ? (total / b.qty).toFixed(2) : total.toFixed(2);

      // Check if an invoice already exists for this booking
      let invoiceNumber = ref;
      const { data: existingInv } = await supabase
        .from("invoices")
        .select("id, invoice_number")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existingInv?.invoice_number) {
        invoiceNumber = existingInv.invoice_number;
      } else {
        // Create invoice if it doesn't exist
        try {
          const invNumRes = await supabase.rpc("next_invoice_number", { p_business_id: businessId });
          invoiceNumber = invNumRes.data || ref;

          const { data: invData } = await supabase.from("invoices").insert({
            business_id: businessId,
            booking_id: bookingId,
            invoice_number: invoiceNumber,
            customer_name: b.customer_name || "Customer",
            customer_email: b.email,
            customer_phone: b.phone || null,
            tour_name: tourName,
            tour_date: b.slots?.start_time || null,
            qty: b.qty,
            unit_price: Number(unitPrice),
            subtotal: total,
            total_amount: total,
            payment_method: b.status === "PAID" ? "Admin (Manual)" : "Pending",
          }).select("id").single();

          if (invData?.id) {
            await supabase.from("bookings").update({ invoice_id: invData.id }).eq("id", bookingId);
          }
        } catch (invErr) {
          console.error("Invoice creation failed:", invErr);
        }
      }

      const res = await supabase.functions.invoke("send-email", {
        body: {
          type: "INVOICE",
          data: {
            business_id: businessId,
            email: b.email,
            customer_name: b.customer_name || "Customer",
            customer_email: b.email,
            invoice_number: invoiceNumber,
            invoice_date: startTime,
            tour_name: tourName,
            tour_date: startTime,
            qty: b.qty,
            unit_price: unitPrice,
            subtotal: total.toFixed(2),
            total_amount: total.toFixed(2),
            payment_method: b.status === "PAID" ? "Admin (Manual)" : "Pending",
            payment_reference: ref,
          },
        },
      });
      if (res.error) notify({ title: "Invoice send failed", message: res.error.message, tone: "error" });
      else notify({ title: "Invoice sent", message: "Invoice " + invoiceNumber + " sent to " + b.email, tone: "success" });
    } catch (err: unknown) {
      notify({ title: "Invoice send failed", message: err instanceof Error ? err.message : String(err), tone: "error" });
    }
    setResendingInvoiceId(null);
  }

  function openEditModal(b: Booking) {
    setEditBooking(b);
    setEditForm({
      customer_name: b.customer_name || "",
      phone: b.phone || "",
      email: b.email || "",
      qty: String(b.qty || 1),
      total_amount: String(Number(b.total_amount || 0).toFixed(2)),
      status: b.status || "PENDING",
    });
  }

  async function saveEditBooking() {
    if (!editBooking) return;
    console.log("[BOOKINGS] saveEditBooking", { bookingId: editBooking.id, editForm });
    const qty = Math.max(1, Number(editForm.qty) || 1);
    const total = Number(editForm.total_amount) || 0;
    setActionBookingId(editBooking.id);

    const isChangingToPaid = editForm.status === "PAID" && editBooking.status !== "PAID";

    // Detect if price or qty changed on a PENDING booking with an existing payment link
    const isPending = ["PENDING", "PENDING PAYMENT", "HELD"].includes(editBooking.status);
    const priceOrQtyChanged = qty !== editBooking.qty || total !== Number(editBooking.total_amount || 0);
    const shouldInvalidatePaymentLink = isPending && priceOrQtyChanged && editBooking.yoco_checkout_id;

    const updateData: Record<string, unknown> = {
      customer_name: editForm.customer_name.trim(),
      phone: normalizePhone(editForm.phone),
      email: editForm.email.trim().toLowerCase(),
      qty,
      total_amount: total,
      status: isChangingToPaid ? editBooking.status : editForm.status,
    };

    // Invalidate stale payment link if price/qty changed on a pending booking
    if (shouldInvalidatePaymentLink) {
      updateData.yoco_checkout_id = null;
    }

    const { error } = await supabase
      .from("bookings")
      .update(updateData)
      .eq("id", editBooking.id);

    if (error) {
      setActionBookingId(null);
      notify({ title: "Booking update failed", message: error.message, tone: "error" });
      return;
    }

    if (shouldInvalidatePaymentLink) {
      // Note: Yoco Checkout API does not currently support cancelling an existing checkout.
      // The old checkout link will simply expire or fail if the customer tries to use it.
      notify({
        title: "Payment link invalidated",
        message: "Previous payment link has been invalidated because the price or guest count changed. Send a new payment link.",
        tone: "warning",
      });
    }

    if (isChangingToPaid) {
      try {
        const res = await supabase.functions.invoke("manual-mark-paid", {
          body: { action: "mark_paid", booking_id: editBooking.id },
        });
        if (res.error) {
          notify({ title: "Marked update partially failed", message: "Booking updated, but mark paid failed: " + res.error.message, tone: "warning" });
        } else if (res.data?.error) {
          notify({ title: "Marked update partially failed", message: "Booking updated, but mark paid failed: " + res.data.error, tone: "warning" });
        } else {
          notify({ title: "Booking updated", message: "Booking details and paid status were updated successfully.", tone: "success" });
        }
      } catch (err: unknown) {
        notify({ title: "Mark paid failed", message: err instanceof Error ? err.message : String(err), tone: "error" });
      }
    } else if (!shouldInvalidatePaymentLink) {
      notify({ title: "Booking updated", message: "Booking details were saved successfully.", tone: "success" });
    }

    setActionBookingId(null);
    setEditBooking(null);
    loadBookings();
  }

  async function markPaid(b: Booking) {
    console.log("[BOOKINGS] markPaid", { bookingId: b.id, currentStatus: b.status });
    setActionBookingId(b.id);
    try {
      const res = await supabase.functions.invoke("manual-mark-paid", {
        body: { action: "mark_paid", booking_id: b.id },
      });
      if (res.error) {
        notify({ title: "Mark paid failed", message: res.error.message, tone: "error" });
      } else if (res.data?.error) {
        notify({ title: "Mark paid failed", message: res.data.error, tone: "error" });
      } else {
        notify({ title: "Booking marked paid", message: "Notifications were sent to the customer.", tone: "success" });
      }
    } catch (err: unknown) {
      notify({ title: "Mark paid failed", message: err instanceof Error ? err.message : String(err), tone: "error" });
    }
    setActionBookingId(null);
    loadBookings();
  }

  async function cancelBooking(b: Booking) {
    console.log("[BOOKINGS] cancelBooking", { bookingId: b.id, status: b.status, customerName: b.customer_name });
    const isVoucherPaid = ((b as any).payment_method || "").toUpperCase() === "VOUCHER" || ((b as any).payment_method || "").toUpperCase() === "GIFT_VOUCHER";
    const confirmMsg = isVoucherPaid
      ? `Cancel booking ${b.id.substring(0, 8).toUpperCase()}? This booking was paid via voucher — a new voucher will be issued for the full amount (no refund to card).`
      : `Cancel booking ${b.id.substring(0, 8).toUpperCase()}? The customer will be notified via email and WhatsApp.`;

    if (!await confirmAction({
      title: "Cancel booking",
      message: confirmMsg,
      tone: "warning",
      confirmLabel: "Cancel booking",
    })) return;
    setActionBookingId(b.id);

    // For voucher-paid bookings, use rebook-booking CANCEL_VOUCHER to issue a voucher instead of Yoco refund
    if (isVoucherPaid && ["PAID", "CONFIRMED", "COMPLETED"].includes(b.status)) {
      try {
        const res = await fetch(SU + "/functions/v1/rebook-booking", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
          body: JSON.stringify({ booking_id: b.id, action: "CANCEL_VOUCHER" }),
        });
        const data = await res.json();
        setActionBookingId(null);
        if (data.ok) {
          notify({
            title: "Booking cancelled — voucher issued",
            message: `Voucher ${data.voucher_code} for R${Number(data.voucher_amount).toFixed(2)} issued to customer.`,
            tone: "success",
          });
        } else {
          notify({ title: "Cancel failed", message: data.error || "Unknown error", tone: "error" });
        }
        loadBookings();
        return;
      } catch (e: any) {
        setActionBookingId(null);
        notify({ title: "Cancel failed", message: e.message || "Network error", tone: "error" });
        return;
      }
    }

    // Delegate to the cancel-booking edge function — centralises atomic
    // state updates (status, holds, slot counters, refund_status), the
    // two-step WhatsApp flow (reopener template + queued full message when
    // the 24h service window is closed), email notification, and audit logging.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setActionBookingId(null);
      notify({ title: "Session expired", message: "Please sign in again and try again.", tone: "error" });
      return;
    }
    try {
      const res = await fetch(SU + "/functions/v1/cancel-booking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.access_token,
        },
        body: JSON.stringify({ booking_id: b.id, reason: "Cancelled by admin" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        notify({ title: "Cancel failed", message: (data as any)?.error || res.statusText || "Unknown error", tone: "error" });
        setActionBookingId(null);
        return;
      }
      notify({
        title: "Booking cancelled",
        message: (data as any)?.refund_action_required
          ? `Customer notified. Refund of R${Number((data as any).refund_amount || 0).toFixed(2)} pending their choice.`
          : "Customer notified.",
        tone: "success",
      });
    } catch (err: any) {
      notify({ title: "Cancel failed", message: err?.message || "Network error", tone: "error" });
      setActionBookingId(null);
      return;
    }

    setActionBookingId(null);
    loadBookings();
  }

  async function cancelSlotWeather(group: SlotGroup) {
    console.log("[BOOKINGS] cancelSlotWeather", { timeLabel: group.timeLabel, bookingCount: group.bookings.length });
    const activeBks = group.bookings.filter(b => !["CANCELLED", "REFUNDED"].includes(b.status));
    const slotId = group.bookings[0]?.slot_id;
    if (!slotId) return;

    if (!await confirmAction({
      title: "Cancel slot due to weather",
      message: `Cancel "${group.timeLabel}" due to weather? This closes the slot, cancels all bookings on it, and notifies customers with reschedule, voucher, or refund options.`,
      tone: "warning",
      confirmLabel: "Cancel slot",
    })) return;

    setCancellingWeatherId(slotId);
    try {
      // Delegate to weather-cancel edge function — atomic per-slot capacity, customer notifications,
      // and self-service compensation links. Replaces the previous N+1 read-then-write loop.
      const { data, error } = await supabase.functions.invoke("weather-cancel", {
        body: { slot_ids: [slotId], business_id: businessId, reason: "weather conditions" },
      });
      if (error) throw error;
      const cancelled = (data as any)?.bookings_cancelled ?? activeBks.length;
      const paidCount = activeBks.filter(b => ["PAID", "CONFIRMED"].includes(b.status)).length;
      notify({
        title: "Weather cancellation complete",
        message: `${cancelled} booking(s) cancelled.${paidCount > 0 ? ` ${paidCount} paid customer(s) were notified.` : " No paid bookings to notify."}`,
        tone: "success",
      });
      loadBookings();
    } catch (err: any) {
      notify({ title: "Weather cancellation failed", message: err.message, tone: "error" });
    }
    setCancellingWeatherId(null);
  }

  function checkRefundLimit(): boolean {
    const key = "ck_refund_log";
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const log: number[] = JSON.parse(localStorage.getItem(key) || "[]").filter((t: number) => now - t < hour);
    if (log.length >= 10) {
      notify({ title: "Refund limit reached", message: "Maximum 10 refunds per hour for security. Please wait before processing more.", tone: "warning" });
      return false;
    }
    log.push(now);
    localStorage.setItem(key, JSON.stringify(log));
    return true;
  }

  function openRefundDialog(b: Booking) {
    setRefundDialog({ booking: b, amount: Number(b.total_amount || 0).toFixed(2) });
  }

  async function processRefund() {
    if (!refundDialog || refunding) return;
    const b = refundDialog.booking;
    const amount = parseFloat(refundDialog.amount);
    console.log("[BOOKINGS] processRefund", { bookingId: b.id, amount, hasYocoCheckout: !!b.yoco_checkout_id });
    if (isNaN(amount) || amount <= 0) { notify({ title: "Invalid refund amount", message: "Enter a valid refund amount.", tone: "warning" }); return; }
    if (amount > Number(b.total_amount || 0)) { notify({ title: "Refund too high", message: "Refund cannot exceed the booking total.", tone: "warning" }); return; }
    if (!checkRefundLimit()) return;

    setRefunding(true);
    setActionBookingId(b.id);
    try {
      if (b.yoco_checkout_id && SU && SK) {
        // Yoco refund — edge function handles booking update, notifications, and logging
        const r = await fetch(SU + "/functions/v1/process-refund", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
          body: JSON.stringify({ booking_id: b.id, amount }),
        });
        const d = await r.json();
        if (!r.ok || d?.error) {
          notify({ title: "Yoco refund failed", message: d?.error || r.statusText || "Unknown", tone: "error" });
          return;
        }
      } else {
        // Manual (non-Yoco) refund — update booking directly
        const isPartial = amount < Number(b.total_amount || 0);
        const { error } = await supabase.from("bookings").update({
          status: "CANCELLED",
          refund_status: "PROCESSED",
          refund_amount: amount,
          refund_notes: `${isPartial ? "Partial" : "Full"} manual refund from bookings page — R${amount.toFixed(2)} of R${Number(b.total_amount || 0).toFixed(2)}`,
          cancellation_reason: "Auto-cancelled — refund processed by admin",
          cancelled_at: new Date().toISOString(),
        }).eq("id", b.id);

        if (error) { notify({ title: "Refund update failed", message: error.message, tone: "error" }); return; }
      }

      setRefundDialog(null);
      notify({ title: "Refund processed", message: "The refund was recorded successfully.", tone: "success" });
      loadBookings();
    } catch (err: unknown) {
      notify({ title: "Refund failed", message: err instanceof Error ? err.message : String(err), tone: "error" });
    } finally {
      setRefunding(false);
      setActionBookingId(null);
    }
  }

  function openRebookModal(b: Booking) {
    setRebookBooking(b);
    setRebookDate(b.slots?.start_time ? toDateInput(b.slots.start_time) : toDateInput(new Date().toISOString()));
    setRebookSlotId("");
    setRebookExcessAction("REFUND");
    setRebookSlots([]);
  }

  async function sendPaymentLink(b: Booking) {
    console.log("[BOOKINGS] sendPaymentLink", { bookingId: b.id, email: b.email, amount: b.total_amount });
    if (!b.email) {
      notify({ title: "Missing email", message: "No email address on this booking. Please edit the booking to add an email first.", tone: "warning" });
      return;
    }
    setPaymentLinkBookingId(b.id);
    try {
      const res = await supabase.functions.invoke("create-checkout", {
        body: {
          amount: Number(b.total_amount || 0),
          booking_id: b.id,
          type: "BOOKING",
          customer_name: b.customer_name || "",
          qty: b.qty || 1,
        },
      });
      if (res.error) {
        notify({ title: "Payment link failed", message: res.error.message, tone: "error" });
        setPaymentLinkBookingId(null);
        return;
      }
      const data = res.data;
      if (data?.redirectUrl) {
        // create-checkout now sends WhatsApp + email notifications automatically
        const ref = b.id.substring(0, 8).toUpperCase();
        setPaymentLinkUrl(data.redirectUrl);
        setPaymentLinkRef(ref);
        loadBookings();
      } else {
        notify({ title: "Payment link failed", message: JSON.stringify(data), tone: "error" });
      }
    } catch (err: unknown) {
      notify({ title: "Payment link failed", message: err instanceof Error ? err.message : String(err), tone: "error" });
    }
    setPaymentLinkBookingId(null);
  }

  async function quickResendPaymentLink(b: Booking) {
    console.log("[BOOKINGS] quickResendPaymentLink", { bookingId: b.id, email: b.email });
    if (!b.email) {
      notify({ title: "Missing email", message: "No email address on this booking.", tone: "warning" });
      return;
    }
    setQuickResendingId(b.id);
    try {
      const res = await supabase.functions.invoke("create-checkout", {
        body: {
          amount: Number(b.total_amount || 0),
          booking_id: b.id,
          type: "BOOKING",
          customer_name: b.customer_name || "",
          qty: b.qty || 1,
        },
      });
      if (res.error) {
        notify({ title: "Payment link failed", message: res.error.message, tone: "error" });
        setQuickResendingId(null);
        return;
      }
      const data = res.data;
      if (data?.redirectUrl) {
        // create-checkout now sends WhatsApp + email notifications automatically
        notify({ title: "Payment link sent", message: `Sent to ${b.email}${b.phone ? " & WhatsApp" : ""}`, tone: "success" });
        loadBookings();
      } else {
        notify({ title: "Payment link failed", message: "No redirect URL returned", tone: "error" });
      }
    } catch (err: unknown) {
      notify({ title: "Payment link failed", message: err instanceof Error ? err.message : String(err), tone: "error" });
    }
    setQuickResendingId(null);
  }

  async function loadRebookSlots(dateInput: string) {
    setLoadingRebookSlots(true);
    const { startIso, endIso } = dayRange(dateInput);
    const data = await listAvailableSlots({
      businessId,
      startIso,
      endIso,
      tourId: null,
    });
    setRebookSlots((data || []) as RebookSlot[]);
    setLoadingRebookSlots(false);
  }

  useEffect(() => {
    if (!rebookBooking || !rebookDate) return;
    const t = setTimeout(() => {
      loadRebookSlots(rebookDate);
    }, 0);
    return () => clearTimeout(t);
  }, [rebookBooking, rebookDate]);


  async function saveRebook() {
    if (!rebookBooking || !rebookSlotId) return;
    console.log("[BOOKINGS] saveRebook", { bookingId: rebookBooking.id, newSlotId: rebookSlotId, excessAction: rebookExcessAction });
    setActionBookingId(rebookBooking.id);
    const { data, error } = await supabase.functions.invoke("rebook-booking", {
      body: {
        booking_id: rebookBooking.id,
        new_slot_id: rebookSlotId,
        excess_action: rebookExcessAction,
      }
    });

    setActionBookingId(null);
    if (error || data?.error) {
      notify({ title: "Rebook failed", message: error?.message || data?.error, tone: "error" });
      return;
    }

    if (data?.diff > 0) {
      notify({
        title: "Booking changed",
        message: "Cost increased by R" + data.diff + ". A payment link was sent to the customer's email and WhatsApp.",
        tone: "success",
      });
    } else {
      notify({ title: "Booking changed", message: "The booking was successfully changed.", tone: "success" });
    }

    setRebookBooking(null);
    loadBookings();
  }

  function openWhatsApp(b: Booking) {
    if (!b.phone) { notify({ title: "Missing phone", message: "No phone number on this booking.", tone: "warning" }); return; }
    setWaMessage("");
    setWaDialog({ phone: normalizePhone(b.phone), name: b.customer_name || "the customer" });
  }

  async function sendWhatsAppGreeting() {
    if (!waDialog || !waMessage.trim() || waSending) return;
    console.log("[BOOKINGS] sendWhatsAppGreeting", { phone: waDialog.phone, name: waDialog.name });
    setWaSending(true);
    try {
      const phone = waDialog.phone;

      // Ensure conversation exists and is set to HUMAN
      const { data: existing } = await supabase
        .from("conversations")
        .select("id, status")
        .eq("phone", phone)
        .maybeSingle();

      if (existing) {
        if (existing.status !== "HUMAN") {
          await supabase.from("conversations")
            .update({ status: "HUMAN", updated_at: new Date().toISOString() })
            .eq("id", existing.id);
        }
      } else {
        await supabase.from("conversations").insert({
          phone,
          customer_name: waDialog.name,
          status: "HUMAN",
          current_state: "IDLE",
          business_id: businessId,
        });
      }

      // Send the message via admin-reply
      const res = await supabase.functions.invoke("admin-reply", {
        body: { phone, message: waMessage.trim(), business_id: businessId },
      });

      if (res.error) {
        notify({ title: "WhatsApp send failed", message: res.error.message, tone: "error" });
        return;
      }
      if (res.data?.ok === false) {
        let errMsg = res.data.error || "Unknown error";
        if (res.data.details?.error?.error_data?.details) errMsg += "\n" + res.data.details.error.error_data.details;
        else if (res.data.details?.error?.message) errMsg += "\n" + res.data.details.error.message;
        notify({ title: "WhatsApp send failed", message: errMsg, tone: "error" });
        return;
      }

      setWaDialog(null);
      notify({ title: "WhatsApp sent", message: "The message was sent and the conversation was opened in Inbox.", tone: "success" });
      router.push("/inbox?phone=" + encodeURIComponent(phone));
    } catch (err: any) {
      notify({ title: "WhatsApp send failed", message: err.message, tone: "error" });
    } finally {
      setWaSending(false);
    }
  }

  function escapeCsvField(val: string) {
    if (!val) return "";
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  }

  function exportCsv(includeSensitive: boolean) {
    const tz = getAdminTimezone();
    const headers = ["Ref", "Customer", "Phone", "Email", "Tour", "Date", "Time", "Guests", "Total", "Status", "Source", "Waiver", "Special Requests"];
    const rows = filteredBookings.map((b) => {
      const specialRequests = b.custom_fields?.special_requests || "";
      const maskedRequests = includeSensitive ? specialRequests : (specialRequests ? "[Protected - View in Dashboard]" : "");
      return [
        b.id.substring(0, 8).toUpperCase(),
        b.customer_name || "",
        b.phone || "",
        b.email || "",
        b.tours?.name || "",
        b.slots?.start_time ? fmtDate(b.slots.start_time) : "",
        b.slots?.start_time ? fmtTime(b.slots.start_time) : "",
        String(b.qty || 0),
        String(b.total_amount || 0),
        b.status || "",
        b.source || "",
        b.waiver_status || "",
        maskedRequests,
      ].map(escapeCsvField).join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bookings-" + new Date().toISOString().split("T")[0] + (includeSensitive ? "-sensitive" : "") + ".csv";
    a.click();
    URL.revokeObjectURL(url);

    // Log audit entry when sensitive data is exported
    if (includeSensitive) {
      supabase.from("logs").insert({
        business_id: businessId,
        event: "sensitive_csv_export",
        payload: {
          exported_by_role: role,
          booking_count: filteredBookings.length,
          exported_at: new Date().toISOString(),
        },
      }).then(() => {});
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Bookings</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCsv(false)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            title="Export CSV (special requests masked)"
          >
            <DownloadSimple className="h-4 w-4" /> Export CSV
          </button>
          {isPrivilegedRole && (
            <button
              onClick={() => exportCsv(true)}
              className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
              title="Export with sensitive data (special requests visible)"
            >
              <DownloadSimple className="h-4 w-4" /> Export with Sensitive Data
            </button>
          )}
        </div>
      </div>

      {/* WhatsApp compose dialog */}
      {waDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-base font-semibold text-gray-900">WhatsApp {waDialog.name}</h3>
            <p className="mb-4 text-xs text-gray-500">{waDialog.phone}</p>
            <textarea
              autoFocus
              rows={4}
              value={waMessage}
              onChange={e => setWaMessage(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendWhatsAppGreeting(); } }}
              placeholder="Type your greeting… (Enter to send, Shift+Enter for new line)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setWaDialog(null)}
                disabled={waSending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={sendWhatsAppGreeting}
                disabled={waSending || !waMessage.trim()}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {waSending ? "Sending…" : "Send & Open Inbox"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refund dialog */}
      {refundDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-base font-semibold text-gray-900">Refund Booking</h3>
            <p className="mb-1 text-xs text-gray-500">{refundDialog.booking.customer_name} · {refundDialog.booking.id.substring(0, 8).toUpperCase()}</p>
            <p className="mb-4 text-xs text-gray-400">Booking total: {fmtCurrency(Number(refundDialog.booking.total_amount || 0))}</p>
            <label className="mb-1 block text-xs font-medium text-gray-700">Refund amount (R)</label>
            <input
              autoFocus
              type="number"
              min="0.01"
              step="0.01"
              max={Number(refundDialog.booking.total_amount || 0)}
              value={refundDialog.amount}
              onChange={e => setRefundDialog(d => d ? { ...d, amount: e.target.value } : null)}
              onKeyDown={e => e.key === "Enter" && processRefund()}
              className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRefundDialog(null)} disabled={refunding} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={processRefund} disabled={refunding || !refundDialog.amount} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                {refunding ? "Processing…" : "Refund & Cancel Booking"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <button onClick={() => shiftRange(-7)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
          ← Prev Week
        </button>
        <span className="text-sm font-medium text-gray-700">
          {rangeStart.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} —{" "}
          {rangeEnd.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
        </span>
        <button onClick={() => shiftRange(7)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
          Next Week →
        </button>
        <button
          onClick={() => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            setRangeStart(d);
            const e = new Date();
            e.setDate(e.getDate() + 7);
            e.setHours(23, 59, 59, 999);
            setRangeEnd(e);
          }}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800"
        >
          Today
        </button>

        <div className="flex w-full items-center gap-2 pt-1 sm:ml-auto sm:w-auto sm:border-l sm:border-gray-300 sm:pl-4 sm:pt-0">
          <label className="text-sm font-medium text-gray-600">Filter Month:</label>
          <div className="min-w-0 flex-1 sm:flex-none">
            <MonthPicker
              onChange={handleMonthChange}
              value={`${rangeStart.getFullYear()}-${String(rangeStart.getMonth() + 1).padStart(2, "0")}`}
            />
          </div>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { key: "ALL", label: "All" },
          { key: "PENDING", label: "Pending" },
          { key: "PAID", label: "Paid" },
          { key: "CONFIRMED", label: "Confirmed" },
          { key: "COMPLETED", label: "Completed" },
          { key: "CANCELLED", label: "Cancelled" },
        ].map((tab) => {
          const isActive = statusFilter === tab.key;
          const count = tab.key === "ALL"
            ? bookings.length
            : bookings.filter((b) => (STATUS_FILTER_MAP[tab.key] || []).includes(b.status)).length;
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
                (isActive
                  ? "bg-gray-900 text-white"
                  : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50")
              }
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
        </div>
      ) : dayGroups.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          {statusFilter !== "ALL" ? "No " + statusFilter.toLowerCase() + " bookings in this date range." : "No bookings in this date range."}
        </div>
      ) : (
        <>
        {selected.size > 0 && (
          <div className="sticky top-0 z-20 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-3 shadow-sm">
            <span className="text-sm font-semibold text-blue-900">{selected.size} selected</span>
            <div className="flex-1" />
            {selectionAllPaid && (
              <button onClick={() => runBulk("checkin")} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors">
                Check in
              </button>
            )}
            {selectionAllUnpaid && (
              <button onClick={() => runBulk("markpaid")} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors">
                Mark paid (EFT)
              </button>
            )}
            {selectionNoneCancelled && (
              <button onClick={() => runBulk("cancel")} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors">
                Cancel
              </button>
            )}
            {selectionAllPaid && (
              <button onClick={() => runBulk("refund")} className="px-3 py-1.5 rounded-lg bg-red-700 text-white text-xs font-semibold hover:bg-red-800 transition-colors">
                Refund
              </button>
            )}
            <button onClick={clearSelection} className="px-3 py-1.5 text-xs text-blue-700 underline hover:text-blue-900">
              Clear
            </button>
          </div>
        )}

        <div className="space-y-6 pb-48">
          {dayGroups.map((day) => {
            const slotKeys = day.slots.map((_, i) => `${day.sortKey}-${i}`);
            const allExpanded = expandAllDays.has(day.sortKey);
            return (
              <div key={day.sortKey}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-gray-800">{day.dateLabel}</h3>
                  <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={allExpanded}
                      onChange={() => toggleExpandAll(day.sortKey, slotKeys)}
                      className="rounded border-gray-300"
                    />
                    Expand All
                  </label>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto no-scrollbar lg:overflow-visible">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="w-8 p-1.5 lg:p-3 text-center">
                          <input type="checkbox"
                            checked={allVisibleIds.length > 0 && allVisibleIds.every(id => selected.has(id))}
                            onChange={(e) => e.target.checked ? selectAllVisible(allVisibleIds) : clearSelection()}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            aria-label="Select all visible bookings" />
                        </th>
                        <th className="w-24 lg:w-36 p-1.5 lg:p-3 text-left font-semibold text-gray-600 text-[11px] lg:text-sm">Time</th>
                        <th className="w-10 lg:w-16 p-1.5 lg:p-3 text-left font-semibold text-gray-600 text-[11px] lg:text-sm">Pax</th>
                        <th className="hidden p-3 text-left font-semibold text-gray-600 md:table-cell">Details</th>
                        <th className="hidden p-3 text-left font-semibold text-gray-600 md:table-cell">Service</th>
                        <th className="hidden p-3 text-right font-semibold text-gray-600 sm:table-cell">Price</th>
                        <th className="hidden p-3 text-right font-semibold text-gray-600 sm:table-cell">Paid</th>
                        <th className="p-1.5 lg:p-3 text-right font-semibold text-gray-600 text-[11px] lg:text-sm">Due</th>
                        <th className="hidden p-3 text-left font-semibold text-gray-600 lg:table-cell">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {day.slots.map((slot, si) => {
                        const slotKey = `${day.sortKey}-${si}`;
                        const isOpen = expandedSlots.has(slotKey);
                        const services = [...new Set(slot.bookings.map((b) => b.tours?.name).filter(Boolean))].join(", ");
                        return (
                          <SlotRows
                            key={slotKey}
                            slot={slot}
                            services={services}
                            isOpen={isOpen}
                            onToggle={() => toggleSlot(slotKey)}
                            actionBookingId={actionBookingId}
                            resendingInvoiceId={resendingInvoiceId}
                            onEdit={openEditModal}
                            onRebook={openRebookModal}
                            onMarkPaid={markPaid}
                            onRefund={openRefundDialog}
                            onCancel={cancelBooking}
                            onResendInvoice={resendInvoiceForBooking}
                            paymentLinkBookingId={paymentLinkBookingId}
                            onSendPaymentLink={sendPaymentLink}
                            onWhatsApp={openWhatsApp}
                            onView={(b) => router.push(`/bookings/${b.id}`)}
                            onCancelSlot={cancelSlotWeather}
                            cancellingWeatherId={cancellingWeatherId}
                            quickResendingId={quickResendingId}
                            onQuickResend={quickResendPaymentLink}
                            selected={selected}
                            onToggleSelect={toggleSelect}
                          />
                        );
                      })}

                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-700">
                        <td className="p-3"></td>
                        <td className="p-3 text-xs text-gray-500">Totals:</td>
                        <td className="p-3">{day.totalPax}</td>
                        <td className="hidden p-3 md:table-cell"></td>
                        <td className="hidden p-3 md:table-cell"></td>
                        <td className="hidden p-3 text-right sm:table-cell">{fmtCurrency(day.totalPrice)}</td>
                        <td className="hidden p-3 text-right sm:table-cell">{fmtCurrency(day.totalPaid)}</td>
                        <td className={`p-3 text-right ${day.totalDue > 0 ? "text-red-600" : "text-gray-700"}`}>{fmtCurrency(day.totalDue)}</td>
                        <td className="hidden p-3 lg:table-cell"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      {/* Bulk progress dialog */}
      {bulkProgress && (
        <div role="dialog" aria-modal className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
            <h2 className="font-bold text-lg text-gray-900">
              {bulkActionInFlight ? "Running " + bulkActionInFlight + "..." : "Done"}
            </h2>
            <div className="mt-3 space-y-1.5 max-h-80 overflow-auto">
              {bulkProgress.map(p => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  {p.status === "ok" && <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" weight="fill" />}
                  {p.status === "error" && <XCircle className="w-4 h-4 text-red-600 shrink-0" weight="fill" />}
                  {p.status === "pending" && <Spinner className="w-4 h-4 text-gray-400 shrink-0 animate-spin" />}
                  <span className="font-medium text-gray-800 truncate">{p.name}</span>
                  <span className="font-mono text-[10px] text-gray-400">{p.id.slice(0, 8)}</span>
                  {p.error && <span className="text-[11px] text-red-700 truncate ml-auto">— {p.error}</span>}
                </div>
              ))}
            </div>
            {!bulkActionInFlight && (() => {
              var ok = bulkProgress.filter(p => p.status === "ok").length;
              var err = bulkProgress.filter(p => p.status === "error").length;
              return (
                <p className="mt-3 text-xs text-gray-600">
                  {ok} succeeded · {err} failed
                </p>
              );
            })()}
            <div className="mt-4 flex gap-2 justify-end">
              {!bulkActionInFlight && (
                <button onClick={() => { setBulkProgress(null); clearSelection(); }}
                  className="px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-semibold hover:bg-gray-900 transition-colors">
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {editBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-t-2xl border border-gray-200 bg-white p-5 sm:rounded-xl">
            <h3 className="mb-4 text-lg font-semibold">Edit Booking</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-sm text-gray-600 md:col-span-2">
                Name
                <input
                  value={editForm.customer_name}
                  onChange={(e) => setEditForm((p) => ({ ...p, customer_name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-600">
                Mobile
                <input
                  value={editForm.phone}
                  onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-600">
                Email
                <input
                  value={editForm.email}
                  onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-600">
                Qty
                <input
                  type="number"
                  min={1}
                  value={editForm.qty}
                  onChange={(e) => setEditForm((p) => ({ ...p, qty: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-600">
                Total (ZAR)
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={editForm.total_amount}
                  onChange={(e) => setEditForm((p) => ({ ...p, total_amount: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm text-gray-600 md:col-span-2">
                Status
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:flex sm:justify-end">
              <button onClick={() => setEditBooking(null)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
                Close
              </button>
              <button
                onClick={saveEditBooking}
                disabled={actionBookingId === editBooking.id}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {actionBookingId === editBooking.id ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rebookBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-t-2xl border border-gray-200 bg-white p-5 sm:rounded-xl">
            <h3 className="mb-1 text-lg font-semibold">Rebook Booking</h3>
            <p className="mb-4 text-xs text-gray-500">
              {rebookBooking.customer_name} · {rebookBooking.tours?.name || "Tour"}
            </p>
            <label className="text-sm text-gray-600">
              New date
              <div className="mt-1">
                <DatePicker value={rebookDate} onChange={setRebookDate} className="py-2.5 w-full border-gray-300" disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }} />
              </div>
            </label>
            <label className="mt-3 block text-sm text-gray-600">
              Available slots
              <select
                value={rebookSlotId}
                onChange={(e) => setRebookSlotId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select slot</option>
                {rebookSlots
                  .filter((s) => Math.max(Number(s.available_capacity || 0), 0) > 0)
                  .map((s) => {
                    const available = Math.max(Number(s.available_capacity || 0), 0);
                    return (
                      <option key={s.id} value={s.id}>
                        {fmtTime(s.start_time)} · {s.tour_name || "Tour"} · {available} seats
                      </option>
                    );
                  })}
              </select>
            </label>
            <p className="mt-2 text-xs text-gray-500">{loadingRebookSlots ? "Loading slots..." : `${rebookSlots.length} open slots found`}</p>

            {/* Price comparison preview */}
            {rebookSlotId && (() => {
              const selectedSlot = rebookSlots.find((s) => s.id === rebookSlotId);
              if (!selectedSlot) return null;
              const currentUnitPrice = rebookBooking.qty > 0 ? rebookBooking.total_amount / rebookBooking.qty : 0;
              const newUnitPrice = selectedSlot.price_per_person_override ?? selectedSlot.base_price_per_person ?? 0;
              const diff = newUnitPrice - currentUnitPrice;
              return (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Current</span>
                    <span className="font-medium">{fmtCurrency(currentUnitPrice)}/pp</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-gray-600">New</span>
                    <span className="font-medium">{fmtCurrency(newUnitPrice)}/pp</span>
                  </div>
                  {diff !== 0 && (
                    <div className="mt-1 flex justify-between border-t border-gray-200 pt-1">
                      <span className="text-gray-600">Difference</span>
                      <span className={`font-semibold ${diff > 0 ? "text-red-600" : "text-green-600"}`}>
                        {diff > 0 ? "+" : ""}{fmtCurrency(diff)}/pp
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}

            <label className="mt-3 block text-sm text-gray-600">
              If the new tour costs LESS, how should we handle the leftover credit?
              <select
                value={rebookExcessAction}
                onChange={(e) => setRebookExcessAction(e.target.value as "REFUND" | "VOUCHER")}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="REFUND">Request Refund</option>
                <option value="VOUCHER">Issue Gift Voucher (Store Credit)</option>
              </select>
            </label>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:flex sm:justify-end">
              <button onClick={() => setRebookBooking(null)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
                Close
              </button>
              <button
                onClick={saveRebook}
                disabled={!rebookSlotId || actionBookingId === rebookBooking.id}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {actionBookingId === rebookBooking.id ? "Saving..." : "Rebook"}
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentLinkUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-t-2xl border border-gray-200 bg-white p-5 sm:rounded-xl">
            <h3 className="mb-1 text-lg font-semibold">Payment Link Sent</h3>
            <p className="mb-4 text-xs text-gray-500">Booking ref: {paymentLinkRef}</p>
            <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              Payment link has been emailed to the customer.
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-xs font-medium text-gray-500">You can also copy the link:</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  readOnly
                  value={paymentLinkUrl}
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(paymentLinkUrl);
                    notify({ title: "Copied", message: "Payment link copied to clipboard.", tone: "success" });
                  }}
                  className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Copy
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Once the customer pays, the booking will automatically update to PAID on this page.
            </p>
            <div className="mt-4 grid grid-cols-1 sm:flex sm:justify-end">
              <button
                onClick={() => setPaymentLinkUrl(null)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SlotRows({
  slot,
  services,
  isOpen,
  onToggle,
  actionBookingId,
  resendingInvoiceId,
  onEdit,
  onRebook,
  onMarkPaid,
  onRefund,
  onCancel,
  onResendInvoice,
  paymentLinkBookingId,
  onSendPaymentLink,
  onWhatsApp,
  onView,
  onCancelSlot,
  cancellingWeatherId,
  quickResendingId,
  onQuickResend,
  selected,
  onToggleSelect,
}: {
  slot: SlotGroup;
  services: string;
  isOpen: boolean;
  onToggle: () => void;
  actionBookingId: string | null;
  resendingInvoiceId: string | null;
  onEdit: (b: Booking) => void;
  onRebook: (b: Booking) => void;
  onMarkPaid: (b: Booking) => void;
  onRefund: (b: Booking) => void;
  onCancel: (b: Booking) => void;
  onResendInvoice: (bookingId: string) => void;
  paymentLinkBookingId: string | null;
  onSendPaymentLink: (b: Booking) => void;
  onWhatsApp: (b: Booking) => void;
  onView: (b: Booking) => void;
  onCancelSlot: (group: SlotGroup) => void;
  cancellingWeatherId: string | null;
  quickResendingId: string | null;
  onQuickResend: (b: Booking) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const [openActions, setOpenActions] = useState<string | null>(null);
  useEffect(() => {
    if (!openActions) return;
    function handleClick() { setOpenActions(null); }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openActions]);

  return (
    <>
      <tr className="cursor-pointer border-t border-gray-100 transition-colors hover:bg-blue-50/40" onClick={onToggle}>
        <td className="w-8 p-1.5 lg:p-3 text-center" onClick={e => e.stopPropagation()}></td>
        <td className="p-1.5 lg:p-3 font-medium text-blue-700 text-[12px] lg:text-sm">
          <span className="mr-0.5 inline-block w-3 text-gray-400 transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>
            ›
          </span>
          {slot.timeLabel}
          <span className="mt-1 block text-[11px] font-normal text-gray-500 sm:hidden">{services || "No services"} · Due {fmtCurrency(slot.totalDue)}</span>
        </td>
        <td className="p-1.5 lg:p-3 font-semibold text-[11px] lg:text-sm">{slot.totalPax}</td>
        <td className="hidden p-3 text-gray-500 md:table-cell"></td>
        <td className="hidden p-3 text-gray-500 md:table-cell">{services}</td>
        <td className="hidden p-3 text-right sm:table-cell">{fmtCurrency(slot.totalPrice)}</td>
        <td className="hidden p-3 text-right sm:table-cell">{fmtCurrency(slot.totalPaid)}</td>
        <td className={`p-1.5 lg:p-3 text-right font-semibold text-[11px] lg:text-sm ${slot.totalDue > 0 ? "text-red-600" : "text-green-600"}`}>{fmtCurrency(slot.totalDue)}</td>
        <td className="hidden p-3 lg:table-cell">
          <button
            onClick={(e) => { e.stopPropagation(); onCancelSlot(slot); }}
            disabled={cancellingWeatherId === slot.bookings[0]?.slot_id}
            className="px-2 py-1 bg-red-50 text-red-600 font-medium rounded text-xs hover:bg-red-100 border border-red-200 disabled:opacity-50 transition-colors"
            title="Cancel Slot (Weather)"
          >
            {cancellingWeatherId === slot.bookings[0]?.slot_id ? "Cancelling..." : "Cancel Slot"}
          </button>
        </td>
      </tr>

      {isOpen &&
        slot.bookings.map((b) => {
          const refundAmt = b.status === "CANCELLED" && b.refund_amount ? Number(b.refund_amount) : 0;
          const paid = isPaid(b.status) ? Number(b.total_amount) : 0;
          const due = refundAmt > 0 ? refundAmt : Number(b.total_amount || 0) - paid;
          const isLoading = actionBookingId === b.id;
          const isResending = resendingInvoiceId === b.id;
          const isGeneratingLink = paymentLinkBookingId === b.id;
          const hasPaymentLink = Boolean(b.yoco_checkout_id);
          const actionsOpen = openActions === b.id;
          return (
            <tr key={b.id} className={"border-t border-gray-100 text-[11px] lg:text-xs text-gray-600 " + (selected.has(b.id) ? "bg-blue-50/80" : "bg-gray-50/60")}>
              <td className="w-8 p-1.5 lg:p-3 text-center align-top" onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(b.id)} onChange={() => onToggleSelect(b.id)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  aria-label={"Select " + b.customer_name} />
              </td>
              <td className="p-1.5 lg:p-3 pl-2 lg:pl-10 text-gray-400" colSpan={1}>
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-left lg:pointer-events-none"
                    onClick={(e) => { e.stopPropagation(); setOpenActions(actionsOpen ? null : b.id); }}
                  >
                    <span className="inline-block w-2 text-gray-400 transition-transform lg:hidden" style={{ transform: actionsOpen ? "rotate(90deg)" : "none" }}>›</span>
                    <span className="font-medium text-gray-700 truncate max-w-[80px] sm:max-w-none">{b.customer_name}</span>
                    {b.waiver_status === "SIGNED"
                      ? <span title="Waiver signed" className="text-emerald-500 shrink-0">✓</span>
                      : <span title="Waiver not signed" className="text-amber-400 shrink-0 text-[10px]">W</span>}
                    <StatusBadge status={b.status} />
                    {["PENDING", "PENDING PAYMENT"].includes(b.status) && !b.yoco_checkout_id && (
                      <button
                        type="button"
                        title="Quick send payment link"
                        disabled={quickResendingId === b.id}
                        onClick={(e) => { e.stopPropagation(); onQuickResend(b); }}
                        className="inline-flex items-center justify-center rounded p-0.5 text-blue-600 hover:bg-blue-100 disabled:opacity-50 transition-colors shrink-0"
                      >
                        {quickResendingId === b.id
                          ? <SpinnerGap className="h-3 w-3 animate-spin" />
                          : <PaperPlaneTilt className="h-3 w-3" />}
                      </button>
                    )}
                    <SourceBadge source={b.source} />
                  </button>
                  {b.external_ref && (
                    <span className="text-[10px] text-gray-400 font-mono lg:pl-0 pl-[18px]">
                      Ref: {b.external_ref}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-500 lg:hidden pl-[10px]">
                    {b.tours?.name || "—"} · {b.phone || "No mobile"}
                  </span>
                  {b.payment_deadline && !isPaid(b.status) && b.status !== "CANCELLED" && (
                    <PaymentExpiryBadge deadline={b.payment_deadline} />
                  )}
                  {/* Collapsible actions on mobile */}
                  {actionsOpen && (
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-[18px] lg:hidden">
                      <ActionButton label="View" onClick={() => onView(b)} tone="blue" />
                      <ActionButton label="Edit" onClick={() => onEdit(b)} disabled={isLoading} />
                      <ActionButton label="WhatsApp" onClick={() => onWhatsApp(b)} disabled={!b.phone} tone="green" />
                      <ActionButton label="Rebook" onClick={() => onRebook(b)} disabled={isLoading} />
                      <ActionButton label="Mark Paid" onClick={() => onMarkPaid(b)} disabled={isLoading || isPaid(b.status)} tone="green" />
                      <ActionButton
                        label={isGeneratingLink ? "..." : "Pay Link"}
                        onClick={() => onSendPaymentLink(b)}
                        disabled={isGeneratingLink || isPaid(b.status) || b.status === "CANCELLED"}
                        tone="blue"
                      />
                      <ActionButton label="Refund" onClick={() => onRefund(b)} disabled={isLoading || b.status === "CANCELLED"} tone="amber" />
                      <ActionButton label="Cancel" onClick={() => onCancel(b)} disabled={isLoading || b.status === "CANCELLED"} tone="red" />
                      <ActionButton
                        label={isResending ? "..." : "Invoice"}
                        onClick={() => onResendInvoice(b.id)}
                        disabled={isResending}
                        tone="blue"
                      />
                      <RefundBadge status={b.refund_status} />
                    </div>
                  )}
                </div>
              </td>
              <td className="p-1.5 lg:p-3 align-top text-[11px] lg:text-sm">{b.qty}</td>
              <td className="hidden p-3 align-top md:table-cell text-[11px] text-gray-500">
                <div className="flex flex-col mt-0.5">
                  <span>{b.phone || "No mobile"}</span>
                  <span>{b.email || "No email"}</span>
                </div>
              </td>
              <td className="hidden p-3 align-top md:table-cell">{b.tours?.name || "—"}</td>
              <td className="hidden p-3 text-right align-top sm:table-cell">{fmtCurrency(Number(b.total_amount || 0))}</td>
              <td className="hidden p-3 text-right align-top sm:table-cell">{fmtCurrency(paid)}</td>
              <td className={`p-1.5 lg:p-3 text-right align-top font-medium text-[11px] lg:text-sm ${refundAmt > 0 ? "text-amber-600" : due > 0 ? "text-red-600" : "text-green-600"}`}>
                {refundAmt > 0 ? <span title="Refunded">↩ {fmtCurrency(due)}</span> : fmtCurrency(due)}
              </td>
              <td className="hidden p-3 align-top lg:table-cell">
                <div className="space-y-1">
                  <div className="relative mt-1.5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setOpenActions(actionsOpen ? null : b.id); }}
                      className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      Actions ▾
                    </button>
                    {actionsOpen && (
                      <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg origin-top-right" onClick={(e) => e.stopPropagation()}>
                        <ActionMenuItem label="View" onClick={() => { onView(b); setOpenActions(null); }} tone="blue" />
                        <ActionMenuItem label="Edit" onClick={() => { onEdit(b); setOpenActions(null); }} disabled={isLoading} />
                        <ActionMenuItem label="WhatsApp" onClick={() => { onWhatsApp(b); setOpenActions(null); }} disabled={!b.phone} tone="green" />
                        <ActionMenuItem label="Rebook" onClick={() => { onRebook(b); setOpenActions(null); }} disabled={isLoading} />
                        <ActionMenuItem label="Mark Paid" onClick={() => { onMarkPaid(b); setOpenActions(null); }} disabled={isLoading || isPaid(b.status)} tone="green" />
                        <ActionMenuItem
                          label={isGeneratingLink ? "Generating..." : "Payment Link"}
                          onClick={() => { onSendPaymentLink(b); setOpenActions(null); }}
                          disabled={isGeneratingLink || isPaid(b.status) || b.status === "CANCELLED"}
                          tone="blue"
                        />
                        <ActionMenuItem label="Refund" onClick={() => { onRefund(b); setOpenActions(null); }} disabled={isLoading || b.status === "CANCELLED"} tone="amber" />
                        <ActionMenuItem label="Cancel" onClick={() => { onCancel(b); setOpenActions(null); }} disabled={isLoading || b.status === "CANCELLED"} tone="red" />
                        <ActionMenuItem
                          label={isResending ? "Resending..." : "Resend Invoice"}
                          onClick={() => { onResendInvoice(b.id); setOpenActions(null); }}
                          disabled={isResending}
                          tone="blue"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </td>
            </tr>
          );
        })}
    </>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  tone = "gray",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "gray" | "blue" | "green" | "red" | "amber";
}) {
  const tones: Record<string, string> = {
    gray: "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
    blue: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    red: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    amber: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
  };
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50 ${tones[tone]}`}
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-700",
    "PENDING PAYMENT": "bg-red-100 text-red-700",
    HELD: "bg-orange-100 text-orange-700",
    CONFIRMED: "bg-blue-100 text-blue-700",
    PAID: "bg-emerald-100 text-emerald-700",
    COMPLETED: "bg-emerald-100 text-emerald-700",
    CANCELLED: "bg-gray-200 text-gray-700",
  };
  return <span className={`inline-block rounded px-1 lg:px-2 py-0.5 text-[9px] lg:text-[10px] font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>{status}</span>;
}

function RefundBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const colors: Record<string, string> = {
    REQUESTED: "bg-amber-100 text-amber-700",
    PROCESSED: "bg-emerald-100 text-emerald-700",
    FAILED: "bg-red-100 text-red-700",
    TRANSFERRED: "bg-emerald-100 text-emerald-700",
  };
  return <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>Refund {status}</span>;
}

function SourceBadge({ source }: { source: string }) {
  if (!source || source === "WEB") return null;
  const colors: Record<string, string> = {
    VIATOR: "bg-violet-100 text-violet-700",
    GETYOURGUIDE: "bg-orange-100 text-orange-700",
    WHATSAPP: "bg-green-100 text-green-700",
    ADMIN: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`inline-block rounded px-1 lg:px-2 py-0.5 text-[9px] lg:text-[10px] font-semibold tracking-wide ${colors[source] || "bg-gray-100 text-gray-600"}`}>
      {source}
    </span>
  );
}

function ActionMenuItem({
  label,
  onClick,
  disabled,
  tone = "gray",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "gray" | "blue" | "green" | "red" | "amber";
}) {
  const tones: Record<string, string> = {
    gray: "text-gray-700 hover:bg-gray-50",
    blue: "text-blue-700 hover:bg-blue-50",
    green: "text-emerald-700 hover:bg-emerald-50",
    red: "text-red-700 hover:bg-red-50",
    amber: "text-amber-700 hover:bg-amber-50",
  };
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${tones[tone]}`}
    >
      {label}
    </button>
  );
}

function PaymentExpiryBadge({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, []);

  const deadlineMs = new Date(deadline).getTime();
  const diffMs = deadlineMs - now;

  if (diffMs <= 0) {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold bg-red-100 text-red-700 lg:ml-0 ml-[10px]">
        Expired
      </span>
    );
  }

  const totalMin = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const label = hours > 0 ? `Expires in ${hours}h ${mins}m` : `Expires in ${mins}m`;

  // Red if within 2 hours, amber if within 6 hours, otherwise gray
  const urgency =
    diffMs <= 2 * 60 * 60_000
      ? "bg-red-100 text-red-700"
      : diffMs <= 6 * 60 * 60_000
        ? "bg-amber-100 text-amber-700"
        : "bg-gray-100 text-gray-500";

  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold lg:ml-0 ml-[10px] ${urgency}`}>
      {label}
    </span>
  );
}
