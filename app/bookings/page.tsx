"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { confirmAction, notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { listAvailableSlots } from "../lib/slot-availability";
import { Send, Download, ExternalLink } from "lucide-react";
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
  const { businessId } = useBusinessContext();
  const router = useRouter();
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
    d.setDate(d.getDate() + 7);
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

  async function loadBookings() {
    setLoading(true);

    // Two-step approach: first get slot IDs in the date range, then query bookings
    const { data: slotRows } = await supabase
      .from("slots")
      .select("id")
      .eq("business_id", businessId)
      .gte("start_time", rangeStart.toISOString())
      .lte("start_time", rangeEnd.toISOString());

    const slotIds = (slotRows || []).map((s: { id: string }) => s.id);
    if (slotIds.length === 0) {
      setBookings([]);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("bookings")
      .select("id, slot_id, customer_name, phone, email, qty, total_amount, status, source, external_ref, refund_status, refund_amount, yoco_checkout_id, payment_deadline, waiver_status, tours(id,name), slots(id,start_time,tour_id,capacity_total,booked,status)")
      .eq("business_id", businessId)
      .in("slot_id", slotIds)
      .in("status", ["PAID", "CONFIRMED", "HELD", "PENDING", "PENDING PAYMENT", "COMPLETED", "CANCELLED"])
      .order("created_at", { ascending: true })
      .limit(2000);

    const normalized = ((data || []) as Array<Booking & { tours: unknown; slots: unknown }>)
      .map((b) => ({
        ...b,
        tours: (Array.isArray(b.tours) ? b.tours[0] || null : b.tours) as TourRel,
        slots: (Array.isArray(b.slots) ? b.slots[0] || null : b.slots) as SlotRel,
      }))
      .filter((b) => Boolean(b.slots?.start_time));
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
    const channel = supabase
      .channel("bookings-status")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings" },
        () => loadBookings()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rangeStart, rangeEnd]);

  const dayGroups: DayGroup[] = useMemo(() => {
    const dayMap = new Map<string, Map<string, Booking[]>>();
    for (const b of bookings) {
      const startTime = b.slots?.start_time;
      if (!startTime) continue;
      const dk = dateKey(startTime);
      const tk = fmtTime(startTime);
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
      const first = bookings.find((b) => b.slots?.start_time && dateKey(b.slots.start_time) === dk);
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
  }, [bookings]);

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
          const invNumRes = await supabase.rpc("next_invoice_number");
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
    const qty = Math.max(1, Number(editForm.qty) || 1);
    const total = Number(editForm.total_amount) || 0;
    setActionBookingId(editBooking.id);

    const isChangingToPaid = editForm.status === "PAID" && editBooking.status !== "PAID";

    const { error } = await supabase
      .from("bookings")
      .update({
        customer_name: editForm.customer_name.trim(),
        phone: normalizePhone(editForm.phone),
        email: editForm.email.trim().toLowerCase(),
        qty,
        total_amount: total,
        status: isChangingToPaid ? editBooking.status : editForm.status,
      })
      .eq("id", editBooking.id);

    if (error) {
      setActionBookingId(null);
      notify({ title: "Booking update failed", message: error.message, tone: "error" });
      return;
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
    } else {
      notify({ title: "Booking updated", message: "Booking details were saved successfully.", tone: "success" });
    }

    setActionBookingId(null);
    setEditBooking(null);
    loadBookings();
  }

  async function markPaid(b: Booking) {
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
    if (!await confirmAction({
      title: "Cancel booking",
      message: `Cancel booking ${b.id.substring(0, 8).toUpperCase()}?`,
      tone: "warning",
      confirmLabel: "Cancel booking",
    })) return;
    setActionBookingId(b.id);
    const { error } = await supabase
      .from("bookings")
      .update({
        status: "CANCELLED",
        cancellation_reason: "Cancelled by admin",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", b.id);
    setActionBookingId(null);
    if (error) notify({ title: "Cancel failed", message: error.message, tone: "error" });
    else {
      notify({ title: "Booking cancelled", message: "The booking was cancelled successfully.", tone: "success" });
      loadBookings();
    }
  }

  async function cancelSlotWeather(group: SlotGroup) {
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
      await supabase.from("slots").update({ status: "CLOSED" }).eq("id", slotId);

      const affected = activeBks;
      for (const b of affected) {
        const isPaidBooking = ["PAID", "CONFIRMED"].includes(b.status);
        const refundAmount = isPaidBooking ? Number(b.total_amount || 0) : 0;

        await supabase.from("bookings").update({
          status: "CANCELLED",
          cancellation_reason: "Weather cancellation",
          cancelled_at: new Date().toISOString(),
        }).eq("id", b.id);

        const slotData = await supabase.from("slots").select("booked, held").eq("id", slotId).single();
        if (slotData.data) {
          await supabase.from("slots").update({
            booked: Math.max(0, slotData.data.booked - b.qty),
            held: Math.max(0, (slotData.data.held || 0) - (b.status === "HELD" ? b.qty : 0)),
          }).eq("id", slotId);
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
        title: "Weather cancellation complete",
        message: `${affected.length} booking(s) were cancelled and customers were sent self-service follow-up links.`,
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
        const ref = b.id.substring(0, 8).toUpperCase();
        const tourName = b.tours?.name || "Sea Kayak Tour";
        const tourDate = b.slots?.start_time
          ? new Date(b.slots.start_time).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: getAdminTimezone() })
          : "TBC";

        // Send email with payment link
        try {
          await supabase.functions.invoke("send-email", {
            body: {
              type: "PAYMENT_LINK",
              data: {
                email: b.email,
                customer_name: b.customer_name || "Customer",
                ref,
                tour_name: tourName,
                tour_date: tourDate,
                qty: b.qty,
                total_amount: Number(b.total_amount || 0).toFixed(2),
                payment_url: data.redirectUrl,
              },
            },
          });
        } catch (emailErr) {
          console.error("Email send failed:", emailErr);
        }

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
        body: { phone, message: waMessage.trim() },
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

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">📋 Bookings</h2>

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

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
        </div>
      ) : dayGroups.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">No bookings in this date range.</div>
      ) : (
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
                          />
                        );
                      })}

                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-700">
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
            <tr key={b.id} className="border-t border-gray-100 bg-gray-50/60 text-[11px] lg:text-xs text-gray-600">
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
                    <span className={`text-[9px] font-medium lg:pl-0 pl-[10px] ${new Date(b.payment_deadline) < new Date() ? "text-red-600" : "text-amber-600"}`}>
                      {new Date(b.payment_deadline) < new Date()
                        ? "Deadline expired"
                        : `Expires ${new Date(b.payment_deadline).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() })}`
                      }
                    </span>
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
