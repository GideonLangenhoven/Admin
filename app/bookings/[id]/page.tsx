"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { getAdminTimezone } from "../../lib/admin-timezone";
import { ArrowLeft, ArrowCounterClockwise, PaperPlaneTilt } from "@phosphor-icons/react";
import { useBusinessContext } from "../../../components/BusinessContext";
import { notify } from "../../lib/app-notify";

/* ── helpers ── */
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: getAdminTimezone() });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: getAdminTimezone() });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
}
function fmtCurrency(v: number) {
  return "R" + v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ── types ── */
interface BookingDetail {
  id: string;
  business_id: string;
  tour_id: string;
  slot_id: string | null;
  customer_name: string;
  phone: string;
  email: string;
  qty: number;
  unit_price: number;
  total_amount: number;
  original_total: number | null;
  status: string;
  source: string;
  discount_type: string | null;
  discount_percent: number | null;
  yoco_checkout_id: string | null;
  yoco_payment_id: string | null;
  payment_deadline: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  refund_status: string | null;
  refund_amount: number | null;
  refund_notes: string | null;
  custom_fields: Record<string, string> | null;
  waiver_status: string;
  waiver_signed_at: string | null;
  waiver_signed_name: string | null;
  invoice_id: string | null;
  created_by_admin_name: string | null;
  created_by_admin_email: string | null;
  promo_code: string | null;
  discount_amount: number | null;
  discount_notes: string | null;
  voucher_code: string | null;
  voucher_amount_paid: number | null;
  created_at: string;
  tours: { name?: string; duration_minutes?: number; base_price_per_person?: number } | null;
  slots: { start_time?: string; capacity_total?: number; booked?: number; status?: string } | null;
}

interface Invoice {
  id: string;
  invoice_number: string;
  payment_method: string;
  payment_reference: string | null;
  subtotal: number;
  discount_type: string | null;
  discount_percent: number | null;
  discount_amount: number;
  total_amount: number;
  created_at: string;
}

interface LogEntry {
  id: string;
  event: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

interface AutoMessage {
  id: string;
  type: string;
  phone: string;
  created_at: string;
}

interface Hold {
  id: string;
  slot_id: string;
  qty: number;
  status: string;
  expires_at: string;
  created_at: string;
}

interface BookingAddOn {
  id: string;
  qty: number;
  unit_price: number;
  add_ons: { name: string } | null;
}

/* ── status helpers ── */
const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-200",
  "PENDING PAYMENT": "bg-orange-100 text-orange-800 border-orange-200",
  HELD: "bg-blue-100 text-blue-800 border-blue-200",
  CONFIRMED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  PAID: "bg-green-100 text-green-800 border-green-200",
  COMPLETED: "bg-gray-200 text-gray-700 border-gray-300",
  CANCELLED: "bg-red-100 text-red-700 border-red-200",
};

const REFUND_COLORS: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-800 border-amber-200",
  PROCESSED: "bg-green-100 text-green-800 border-green-200",
  TRANSFERRED: "bg-blue-100 text-blue-800 border-blue-200",
  NONE: "bg-gray-100 text-gray-600 border-gray-200",
};

const SOURCE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  WEB_CHAT: "Web Chat",
  WA_WEBHOOK: "WhatsApp",
  REBOOK: "Rebook",
};

/* ── timeline helpers ── */
interface TimelineEvent {
  time: string;
  label: string;
  detail?: string;
}

// TODO: Accept audit_logs as an additional parameter and merge into the timeline.
// Each audit_log entry should display the actor_id (admin user) who performed the action.
// This will provide a full admin audit trail showing who did what and when.
function buildTimeline(
  booking: BookingDetail,
  logs: LogEntry[],
  autoMessages: AutoMessage[],
  holds: Hold[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Booking created
  events.push({
    time: booking.created_at,
    label: "Booking created",
    detail: [
      `Source: ${SOURCE_LABELS[booking.source] || booking.source}`,
      booking.source === "ADMIN" && (booking.created_by_admin_name || booking.created_by_admin_email)
        ? `Created by: ${booking.created_by_admin_name || booking.created_by_admin_email}`
        : "",
      `Status: ${booking.status === "CANCELLED" ? "PENDING" : booking.status}`,
    ].filter(Boolean).join(" | "),
  });

  // Holds
  for (const h of holds) {
    events.push({
      time: h.created_at,
      label: `Slot hold ${h.status === "CONVERTED" ? "converted" : "created"}`,
      detail: `Expires: ${fmtDateTime(h.expires_at)} | Status: ${h.status}`,
    });
  }

  // Log events
  for (const log of logs) {
    const p = (log.payload || {}) as Record<string, string | number | null>;
    switch (log.event) {
      case "payment_confirmed":
        events.push({
          time: log.created_at,
          label: "Payment confirmed (Yoco)",
          detail: `Payment ID: ${p.yoco_payment_id || "—"} | Amount: ${p.amount ? fmtCurrency(Number(p.amount) / 100) : "—"}`,
        });
        break;
      case "payment_marked_manual":
        events.push({
          time: log.created_at,
          label: "Marked as paid (Admin)",
          detail: "Payment recorded manually by admin",
        });
        break;
      case "payment_confirmed_but_status_update_failed":
        events.push({
          time: log.created_at,
          label: "Payment received — status update failed",
          detail: `Error: ${p.error || "Unknown"} | Payment ID: ${p.yoco_payment_id || "—"}`,
        });
        break;
      default:
        events.push({
          time: log.created_at,
          label: log.event.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          detail: Object.keys(p).length > 0 ? JSON.stringify(p) : undefined,
        });
    }
  }

  // Auto-messages
  for (const am of autoMessages) {
    const labels: Record<string, string> = {
      REMINDER: "Day-before reminder sent (WhatsApp)",
      INDEMNITY: "Indemnity email sent",
      REVIEW_REQUEST: "Review request sent (WhatsApp)",
      AUTO_CANCEL: "Auto-cancellation notification sent",
    };
    events.push({
      time: am.created_at,
      label: labels[am.type] || `Auto message: ${am.type}`,
      detail: am.phone ? `To: ${am.phone}` : undefined,
    });
  }

  // Cancellation
  if (booking.cancelled_at) {
    events.push({
      time: booking.cancelled_at,
      label: "Booking cancelled",
      detail: booking.cancellation_reason || undefined,
    });
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return events;
}

/* ── components ── */
function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-100 last:border-b-0">
      <span className="text-xs font-medium text-gray-500 shrink-0">{label}</span>
      <span className={`text-sm text-right text-gray-900 ${mono ? "font-mono text-xs" : ""}`}>{value || "—"}</span>
    </div>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white ${className}`}>
      <div className="border-b border-gray-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  );
}

/* ── page ── */
export default function BookingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const bookingId = params.id as string;
  const { businessId } = useBusinessContext();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoMessages, setAutoMessages] = useState<AutoMessage[]>([]);
  const [holds, setHolds] = useState<Hold[]>([]);
  const [bookingAddOns, setBookingAddOns] = useState<BookingAddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [customerDraft, setCustomerDraft] = useState({ name: "", phone: "", email: "" });
  const [codeInput, setCodeInput] = useState("");
  const [codeApplying, setCodeApplying] = useState(false);
  const [codeResult, setCodeResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [resendingPayment, setResendingPayment] = useState(false);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidMethod, setMarkPaidMethod] = useState<"Cash" | "EFT" | "Card (terminal)" | "Other">("Cash");
  const [markPaidNote, setMarkPaidNote] = useState("");
  const [markPaidLoading, setMarkPaidLoading] = useState(false);
  const [reduceGuestsOpen, setReduceGuestsOpen] = useState(false);
  const [reduceGuestsTarget, setReduceGuestsTarget] = useState(1);
  const [reduceGuestsRefundMode, setReduceGuestsRefundMode] = useState<"REFUND" | "VOUCHER" | "NONE">("REFUND");
  const [reduceGuestsLoading, setReduceGuestsLoading] = useState(false);

  useEffect(() => {
    if (!bookingId || !businessId) return;
    async function load() {
      setLoading(true);
      setError(null);

      const [bookingRes, invoiceRes, logsRes, amRes, holdsRes, addOnsRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("*, tours(name, duration_minutes, base_price_per_person), slots(start_time, capacity_total, booked, status)")
          .eq("id", bookingId)
          .eq("business_id", businessId)
          .maybeSingle(),
        supabase
          .from("invoices")
          .select("id, invoice_number, payment_method, payment_reference, subtotal, discount_type, discount_percent, discount_amount, total_amount, created_at")
          .eq("booking_id", bookingId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("logs")
          .select("id, event, payload, created_at")
          .eq("booking_id", bookingId)
          .order("created_at", { ascending: true }),
        supabase
          .from("auto_messages")
          .select("id, type, phone, created_at")
          .eq("booking_id", bookingId)
          .order("created_at", { ascending: true }),
        supabase
          .from("holds")
          .select("id, slot_id, qty, status, expires_at, created_at")
          .eq("booking_id", bookingId)
          .order("created_at", { ascending: true }),
        supabase
          .from("booking_add_ons")
          .select("id, qty, unit_price, add_ons(name)")
          .eq("booking_id", bookingId),
      ]);

      if (bookingRes.error || !bookingRes.data) {
        setError(bookingRes.error?.message || "Booking not found");
        setLoading(false);
        return;
      }

      setBooking(bookingRes.data as BookingDetail);
      setCustomerDraft({
        name: bookingRes.data.customer_name || "",
        phone: bookingRes.data.phone || "",
        email: bookingRes.data.email || "",
      });
      setInvoice((invoiceRes.data as Invoice) || null);
      setLogs((logsRes.data as LogEntry[]) || []);
      setAutoMessages((amRes.data as AutoMessage[]) || []);
      setHolds((holdsRes.data as Hold[]) || []);
      setBookingAddOns(((addOnsRes.data || []) as any[]).map((row: any) => ({
        ...row,
        add_ons: Array.isArray(row.add_ons) ? row.add_ons[0] : row.add_ons,
      })) as BookingAddOn[]);
      setLoading(false);
    }
    load();
  }, [bookingId, businessId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-gray-500">Loading booking details...</div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="max-w-3xl space-y-4 py-10">
        <button onClick={() => router.push("/bookings")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={16} /> Back to bookings
        </button>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
          {error || "Booking not found"}
        </div>
      </div>
    );
  }

  const ref = booking.id.substring(0, 8).toUpperCase();
  const timeline = buildTimeline(booking, logs, autoMessages, holds);
  const discountAmount = booking.original_total ? Math.max(0, booking.original_total - booking.total_amount) : 0;
  const isPending = ["PENDING", "PENDING PAYMENT", "HELD"].includes(booking.status);
  const isCancelled = booking.status === "CANCELLED";
  const hasRefund = booking.refund_status && booking.refund_status !== "NONE";
  const deadlineExpired = booking.payment_deadline ? new Date(booking.payment_deadline) < new Date() : false;

  async function saveCustomerDetails() {
    if (!booking) return;
    setSavingCustomer(true);
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        customer_name: customerDraft.name.trim(),
        phone: customerDraft.phone.trim(),
        email: customerDraft.email.trim().toLowerCase(),
      })
      .eq("id", booking.id);
    if (!updateError) {
      setBooking({
        ...booking,
        customer_name: customerDraft.name.trim(),
        phone: customerDraft.phone.trim(),
        email: customerDraft.email.trim().toLowerCase(),
      });
      setEditingCustomer(false);
    }
    setSavingCustomer(false);
  }

  async function applyCode() {
    if (!booking || !codeInput.trim()) return;
    setCodeApplying(true);
    setCodeResult(null);
    const code = codeInput.trim().toUpperCase().replace(/\s/g, "");

    try {
      // Try voucher first
      const { data: voucher } = await supabase
        .from("vouchers")
        .select("id, code, status, type, value, current_balance, purchase_amount, pax_limit, purchase_value")
        .eq("code", code)
        .eq("business_id", businessId)
        .maybeSingle();

      if (voucher) {
        if (voucher.status !== "ACTIVE") {
          setCodeResult({ type: "error", message: `Voucher ${code} is ${voucher.status.toLowerCase()}` });
          setCodeApplying(false);
          return;
        }
        const balance = Number(voucher.current_balance || voucher.value || voucher.purchase_amount || 0);
        const currentTotal = Number(booking.total_amount || 0);
        let deduction = 0;

        if (voucher.type === "FREE_TRIP") {
          const coveredPax = Math.min(voucher.pax_limit || 1, booking.qty);
          const slotCost = Number(booking.unit_price || 0) * coveredPax;
          const purchaseVal = Number(voucher.purchase_value || voucher.purchase_amount || balance);
          deduction = slotCost > purchaseVal ? Math.min(purchaseVal, currentTotal) : Math.min(balance, slotCost, currentTotal);
        } else {
          deduction = Math.min(balance, currentTotal);
        }

        const newTotal = Math.max(0, currentTotal - deduction);

        // Deduct voucher balance atomically
        const { data: rpcRes } = await supabase.rpc("deduct_voucher_balance", { p_voucher_id: voucher.id, p_amount: deduction });
        if (!rpcRes?.success) {
          // Fallback: mark as redeemed
          await supabase.from("vouchers").update({ status: "REDEEMED", redeemed_at: new Date().toISOString(), redeemed_booking_id: booking.id }).eq("id", voucher.id);
        } else {
          await supabase.from("vouchers").update({ redeemed_booking_id: booking.id }).eq("id", voucher.id);
        }

        // Update booking. Preserve any prior promo attribution and store the
        // voucher deduction as a *separate* field (voucher_amount_paid) so the
        // audit trail shows promo + voucher individually. discount_type kept
        // as VOUCHER for backward-compatibility with downstream summarisation.
        const updateFields: Record<string, unknown> = {
          total_amount: newTotal,
          voucher_code: code,
          voucher_amount_paid: Math.round(deduction * 100) / 100,
          discount_type: "VOUCHER",
        };
        if (newTotal <= 0) {
          updateFields.status = "PAID";
          updateFields.yoco_payment_id = "VOUCHER_ADMIN_" + code;
        }
        const { error: updateErr } = await supabase.from("bookings").update(updateFields).eq("id", booking.id);
        if (updateErr) {
          console.error("Booking voucher update failed:", updateErr);
          setCodeResult({ type: "error", message: "Voucher deducted but booking update failed: " + updateErr.message });
          setCodeApplying(false);
          return;
        }

        setBooking({ ...booking, total_amount: newTotal, discount_type: "VOUCHER", status: newTotal <= 0 ? "PAID" : booking.status } as BookingDetail);
        setCodeResult({ type: "success", message: `Voucher applied: R${deduction} off. ${newTotal <= 0 ? "Booking is now fully paid!" : `New total: R${newTotal}`}` });
        setCodeInput("");
        setCodeApplying(false);
        return;
      }

      // Try promo code via validate_promo_code RPC.
      // E4: include add-ons in the order amount so the promo applies to
      // (base + add-ons), matching the New Booking page math. Otherwise
      // a 10% promo gives different totals depending on where staff apply it.
      const addOnsTotalForPromo = bookingAddOns.reduce(
        (sum, ao) => sum + Number(ao.qty || 0) * Number(ao.unit_price || 0),
        0,
      );
      const baseTotal = Number(booking.unit_price) * booking.qty + addOnsTotalForPromo;
      const { data: promoResult, error: promoError } = await supabase.rpc("validate_promo_code", {
        p_business_id: booking.business_id,
        p_code: code,
        p_order_amount: baseTotal,
        p_customer_email: booking.email || null,
      });

      if (promoError) {
        console.error("validate_promo_code RPC error:", promoError);
        setCodeResult({ type: "error", message: promoError.message || "Failed to validate promo code" });
        setCodeApplying(false);
        return;
      }

      if (promoResult?.valid) {
        let discountAmt = 0;
        if (promoResult.discount_type === "PERCENT") {
          discountAmt = Math.round(baseTotal * Number(promoResult.discount_value) / 100 * 100) / 100;
        } else {
          discountAmt = Math.min(Number(promoResult.discount_value), baseTotal);
        }
        const newTotal = Math.max(0, Math.round((baseTotal - discountAmt) * 100) / 100);

        await supabase.from("bookings").update({
          total_amount: newTotal,
          original_total: booking.original_total || baseTotal,
          promo_code: promoResult.code,
          discount_amount: discountAmt,
          discount_type: promoResult.discount_type,
          discount_percent: promoResult.discount_type === "PERCENT" ? Number(promoResult.discount_value) : null,
        }).eq("id", booking.id);

        // Record promo usage atomically
        await supabase.rpc("apply_promo_code", {
          p_promo_id: promoResult.promo_id,
          p_customer_email: booking.email || "",
          p_booking_id: booking.id,
          p_customer_phone: booking.phone || null,
        });

        setBooking({
          ...booking,
          total_amount: newTotal,
          original_total: booking.original_total || baseTotal,
          promo_code: promoResult.code,
          discount_amount: discountAmt,
          discount_type: promoResult.discount_type,
          discount_percent: promoResult.discount_type === "PERCENT" ? Number(promoResult.discount_value) : null,
        });
        const discountLabel = promoResult.discount_type === "PERCENT"
          ? `${promoResult.discount_value}% off`
          : `R${promoResult.discount_value} off`;
        setCodeResult({
          type: "success",
          message: `Promo applied: ${fmtCurrency(discountAmt)} off (${discountLabel}). New total: ${fmtCurrency(newTotal)}${newTotal <= 0 ? " \u2014 no payment needed!" : ""}`,
        });
        setCodeInput("");
      } else if (promoResult) {
        setCodeResult({ type: "error", message: promoResult.error || "Invalid promo code" });
      } else {
        setCodeResult({ type: "error", message: "Code not found. Check the code and try again." });
      }
    } catch (err: any) {
      setCodeResult({ type: "error", message: err.message || "Failed to apply code" });
    }
    setCodeApplying(false);
  }

  async function reduceGuests() {
    if (!booking) return;
    if (reduceGuestsTarget < 1 || reduceGuestsTarget >= booking.qty) {
      notify({ title: "Invalid guest count", message: `Please pick a number between 1 and ${booking.qty - 1}.`, tone: "warning" });
      return;
    }
    const isPaidStatus = ["PAID", "CONFIRMED", "COMPLETED"].includes(booking.status);
    setReduceGuestsLoading(true);
    try {
      const res = await supabase.functions.invoke("rebook-booking", {
        body: {
          booking_id: booking.id,
          action: "REMOVE_GUESTS",
          new_qty: reduceGuestsTarget,
          excess_action: isPaidStatus ? reduceGuestsRefundMode : "NONE",
        },
      });
      const data = res.data || {};
      if (res.error || data?.error) {
        notify({ title: "Reduce failed", message: res.error?.message || data?.error || "Failed", tone: "error" });
      } else {
        const msg = data.refund_amount
          ? `Reduced to ${reduceGuestsTarget} guests. ${fmtCurrency(data.refund_amount)} refund initiated.`
          : data.voucher_code
            ? `Reduced to ${reduceGuestsTarget} guests. Voucher ${data.voucher_code} issued for ${fmtCurrency(data.voucher_amount)}.`
            : `Reduced to ${reduceGuestsTarget} guests.`;
        notify({ title: "Guest count reduced", message: msg, tone: "success" });
        setBooking({
          ...booking,
          qty: reduceGuestsTarget,
          total_amount: booking.qty > 0 ? (Number(booking.total_amount) / booking.qty) * reduceGuestsTarget : Number(booking.total_amount),
        } as BookingDetail);
        setReduceGuestsOpen(false);
      }
    } catch (err: any) {
      notify({ title: "Reduce failed", message: err?.message || String(err), tone: "error" });
    }
    setReduceGuestsLoading(false);
  }

  async function markBookingPaid() {
    if (!booking) return;
    setMarkPaidLoading(true);
    try {
      const res = await supabase.functions.invoke("manual-mark-paid", {
        body: {
          action: "mark_paid",
          booking_id: booking.id,
          payment_method: markPaidMethod,
          payment_note: markPaidNote.trim() || undefined,
        },
      });
      if (res.error) {
        notify({ title: "Mark Paid failed", message: res.error.message, tone: "error" });
      } else if (res.data?.error) {
        notify({ title: "Mark Paid failed", message: res.data.error, tone: "error" });
      } else {
        notify({ title: "Booking marked paid", message: `${markPaidMethod} payment recorded. Customer notified.`, tone: "success" });
        setBooking({ ...booking, status: "PAID" });
        setMarkPaidOpen(false);
        setMarkPaidNote("");
      }
    } catch (err: any) {
      notify({ title: "Mark Paid failed", message: err?.message || String(err), tone: "error" });
    }
    setMarkPaidLoading(false);
  }

  async function resendPaymentLink() {
    if (!booking) return;
    setResendingPayment(true);
    setCodeResult(null);
    try {
      const res = await supabase.functions.invoke("create-checkout", {
        body: {
          amount: Number(booking.total_amount || 0),
          booking_id: booking.id,
          business_id: businessId,
          type: "BOOKING",
          customer_name: booking.customer_name || "",
          customer_email: booking.email || "",
          qty: booking.qty || 1,
        },
      });
      if (res.error) {
        const errMsg = "Payment link failed: " + res.error.message;
        setCodeResult({ type: "error", message: errMsg });
        notify({ title: "Payment link failed", message: res.error.message, tone: "error" });
      } else if (res.data?.fully_covered) {
        setCodeResult({ type: "success", message: "Booking fully covered by promo \u2014 no payment needed" });
        notify({ title: "Fully covered", message: "Promo covers the full amount. No payment required.", tone: "success" });
      } else if (res.data?.redirectUrl) {
        setBooking({ ...booking, yoco_checkout_id: res.data.id });
        setCodeResult({ type: "success", message: `New payment link sent to customer (${fmtCurrency(Number(booking.total_amount))})` });
        notify({ title: "Payment link sent", message: "Sent to " + (booking.email || booking.phone), tone: "success" });
      } else {
        setCodeResult({ type: "error", message: "Failed to generate payment link" });
      }
    } catch (err: any) {
      setCodeResult({ type: "error", message: err.message || "Failed" });
    }
    setResendingPayment(false);
  }

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => router.push("/bookings")}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={14} /> Bookings
        </button>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">Booking {ref}</h1>
          <Badge className={STATUS_COLORS[booking.status] || "bg-gray-100 text-gray-600"}>{booking.status}</Badge>
          <Badge className="bg-gray-100 text-gray-600 border-gray-200">{SOURCE_LABELS[booking.source] || booking.source}</Badge>
        </div>
        {isPending && Number(booking.total_amount) > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setMarkPaidOpen((v) => !v)}
              disabled={markPaidLoading}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >
              {markPaidOpen ? "Cancel" : "Mark as Paid"}
            </button>
            <button
              onClick={resendPaymentLink}
              disabled={resendingPayment}
              className="flex items-center gap-1.5 rounded-lg bg-[#0f595e] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0b4347] disabled:opacity-50 transition-colors"
            >
              <PaperPlaneTilt size={14} />
              {resendingPayment ? "Sending..." : "Resend Payment Link"}
            </button>
          </div>
        )}
      </div>

      {/* Mark-as-Paid inline panel — for cash, EFT, or in-person card payments. */}
      {isPending && Number(booking.total_amount) > 0 && markPaidOpen && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-emerald-900">Record manual payment</h3>
            <p className="mt-1 text-xs text-emerald-800">
              Use this to record a cash, EFT, or in-person card payment. The customer will be marked as paid, a confirmation
              email + WhatsApp will be sent, and an invoice will be issued.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-emerald-900">
              Payment method
              <select
                value={markPaidMethod}
                onChange={(e) => setMarkPaidMethod(e.target.value as typeof markPaidMethod)}
                disabled={markPaidLoading}
                className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value="Cash">Cash</option>
                <option value="EFT">EFT / Bank transfer</option>
                <option value="Card (terminal)">Card (in-person terminal)</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-emerald-900">
              Reference / note (optional)
              <input
                type="text"
                value={markPaidNote}
                onChange={(e) => setMarkPaidNote(e.target.value.slice(0, 280))}
                disabled={markPaidLoading}
                placeholder={markPaidMethod === "EFT" ? "Bank reference, e.g. EFT-1234" : markPaidMethod === "Cash" ? "Receipt number, etc." : "Reference"}
                className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => { setMarkPaidOpen(false); setMarkPaidNote(""); }}
              disabled={markPaidLoading}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={markBookingPaid}
              disabled={markPaidLoading}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {markPaidLoading ? "Recording…" : `Mark ${fmtCurrency(Number(booking.total_amount))} as paid`}
            </button>
          </div>
        </div>
      )}

      {/* Booking ID + Created */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span>ID: <span className="font-mono">{booking.id}</span></span>
        <span>Created: {fmtDateTime(booking.created_at)}</span>
        {booking.cancelled_at && <span className="text-red-600">Cancelled: {fmtDateTime(booking.cancelled_at)}</span>}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Customer Details */}
        <Card title="Customer Details">
          <div className="mb-3 flex items-center justify-end gap-2">
            {editingCustomer ? (
              <>
                <button onClick={() => {
                  setCustomerDraft({ name: booking.customer_name || "", phone: booking.phone || "", email: booking.email || "" });
                  setEditingCustomer(false);
                }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={saveCustomerDetails} disabled={savingCustomer} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
                  {savingCustomer ? "Saving..." : "Save"}
                </button>
              </>
            ) : (
              <button onClick={() => setEditingCustomer(true)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                Edit
              </button>
            )}
          </div>
          {editingCustomer && isPending && booking.yoco_checkout_id && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 mb-3">
              <p className="text-xs text-amber-800 leading-snug">
                <span className="font-semibold">Warning:</span> An existing payment link will be invalidated if you save changes. The customer will need a new payment link.
              </p>
            </div>
          )}
          {editingCustomer ? (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-gray-500">
                Name
                <input value={customerDraft.name} onChange={(e) => setCustomerDraft({ ...customerDraft, name: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" />
              </label>
              <label className="block text-xs font-medium text-gray-500">
                Phone
                <input value={customerDraft.phone} onChange={(e) => setCustomerDraft({ ...customerDraft, phone: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" />
              </label>
              <label className="block text-xs font-medium text-gray-500">
                Email
                <input value={customerDraft.email} onChange={(e) => setCustomerDraft({ ...customerDraft, email: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900" />
              </label>
            </div>
          ) : (
            <>
              <InfoRow label="Name" value={booking.customer_name} />
              <InfoRow label="Phone" value={booking.phone || "Not provided"} />
              <InfoRow label="Email" value={booking.email || "Not provided"} />
            </>
          )}
        </Card>

        {/* Tour & Schedule */}
        <Card title="Tour & Schedule">
          <InfoRow label="Tour" value={booking.tours?.name || "—"} />
          <InfoRow
            label="Date & Time"
            value={
              booking.slots?.start_time
                ? `${fmtDate(booking.slots.start_time)} at ${fmtTime(booking.slots.start_time)}`
                : "—"
            }
          />
          <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-100">
            <span className="text-xs font-medium text-gray-500 shrink-0">Guests</span>
            <span className="text-sm text-gray-900 flex items-center gap-2">
              {booking.qty}
              {!isCancelled && booking.qty > 1 && (
                <button
                  onClick={() => {
                    setReduceGuestsOpen((v) => !v);
                    setReduceGuestsTarget(Math.max(1, booking.qty - 1));
                  }}
                  className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                >
                  {reduceGuestsOpen ? "Cancel" : "Reduce"}
                </button>
              )}
            </span>
          </div>
          <InfoRow label="Duration" value={booking.tours?.duration_minutes ? `${booking.tours.duration_minutes} minutes` : "—"} />
          <InfoRow
            label="Slot Status"
            value={
              booking.slots ? (
                <span>
                  {booking.slots.status} ({booking.slots.booked || 0} / {booking.slots.capacity_total || 0} booked)
                </span>
              ) : "—"
            }
          />
          {reduceGuestsOpen && !isCancelled && booking.qty > 1 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
              <p className="text-xs text-amber-900 leading-snug">
                <span className="font-semibold">Reduce guest count.</span> Slot capacity will be freed and the customer will be notified.
                Within 24 hours of the trip this action is blocked.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block text-xs font-medium text-amber-900">
                  New guest count
                  <select
                    value={reduceGuestsTarget}
                    onChange={(e) => setReduceGuestsTarget(Number(e.target.value))}
                    disabled={reduceGuestsLoading}
                    className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900"
                  >
                    {Array.from({ length: booking.qty - 1 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n} guest{n === 1 ? "" : "s"}</option>
                    ))}
                  </select>
                </label>
                {["PAID", "CONFIRMED", "COMPLETED"].includes(booking.status) && (
                  <label className="block text-xs font-medium text-amber-900">
                    Refund the difference as
                    <select
                      value={reduceGuestsRefundMode}
                      onChange={(e) => setReduceGuestsRefundMode(e.target.value as typeof reduceGuestsRefundMode)}
                      disabled={reduceGuestsLoading}
                      className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="REFUND">Refund (95% to card / EFT)</option>
                      <option value="VOUCHER">Voucher (100% credit)</option>
                      <option value="NONE">No refund</option>
                    </select>
                  </label>
                )}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setReduceGuestsOpen(false)}
                  disabled={reduceGuestsLoading}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={reduceGuests}
                  disabled={reduceGuestsLoading}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {reduceGuestsLoading ? "Reducing…" : `Reduce to ${reduceGuestsTarget} guest${reduceGuestsTarget === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Pricing & Payment */}
        <Card title="Pricing & Payment">
          <InfoRow label="Unit Price" value={fmtCurrency(Number(booking.unit_price || 0))} />
          <InfoRow label="Quantity" value={booking.qty} />
          {booking.original_total && discountAmount > 0 && (
            <>
              <InfoRow label="Subtotal" value={fmtCurrency(booking.original_total)} />
              {/* E3: split promo vs voucher into two lines so the audit trail
                  shows each adjustment separately. Falls back to a single
                  Discount line for legacy bookings without split tracking. */}
              {(() => {
                const voucherAmt = Number(booking.voucher_amount_paid || 0);
                const promoAmt = Math.max(0, discountAmount - voucherAmt);
                const hasBoth = voucherAmt > 0 && promoAmt > 0;
                if (hasBoth) {
                  return (
                    <>
                      <InfoRow
                        label="Promo"
                        value={
                          <span className="text-red-600">
                            -{fmtCurrency(promoAmt)}
                            {booking.promo_code ? ` (${booking.promo_code}${booking.discount_type === "PERCENT" && booking.discount_percent ? ` \u2014 ${booking.discount_percent}%` : ""})` : ""}
                          </span>
                        }
                      />
                      <InfoRow
                        label="Voucher"
                        value={
                          <span className="text-red-600">
                            -{fmtCurrency(voucherAmt)}
                            {booking.voucher_code ? ` (${booking.voucher_code})` : ""}
                          </span>
                        }
                      />
                    </>
                  );
                }
                if (voucherAmt > 0) {
                  return (
                    <InfoRow
                      label="Voucher"
                      value={
                        <span className="text-red-600">
                          -{fmtCurrency(voucherAmt)}
                          {booking.voucher_code ? ` (${booking.voucher_code})` : ""}
                        </span>
                      }
                    />
                  );
                }
                return (
                  <InfoRow
                    label="Discount"
                    value={
                      <span className="text-red-600">
                        -{fmtCurrency(discountAmount)}
                        {booking.promo_code
                          ? ` (${booking.promo_code}${booking.discount_type === "PERCENT" && booking.discount_percent ? ` \u2014 ${booking.discount_percent}%` : ""})`
                          : booking.discount_type === "PERCENT" && booking.discount_percent
                            ? ` (${booking.discount_percent}%)`
                            : booking.discount_type ? ` (${booking.discount_type})` : ""}
                      </span>
                    }
                  />
                );
              })()}
            </>
          )}
          <InfoRow
            label="Total Amount"
            value={<span className="font-semibold text-gray-900">{fmtCurrency(Number(booking.total_amount || 0))}</span>}
          />
          <div className="my-2 border-t border-gray-100" />
          <InfoRow label="Payment Method" value={invoice?.payment_method || (booking.yoco_payment_id ? "Yoco" : "Pending")} />
          {invoice && (
            <>
              <InfoRow label="Invoice #" value={invoice.invoice_number} />
              <InfoRow label="Payment Reference" value={invoice.payment_reference} mono />
              <InfoRow label="Invoice Created" value={fmtDateTime(invoice.created_at)} />
            </>
          )}

          {/* Apply Voucher/Promo Code */}
          {!isCancelled && (
            <>
              <div className="my-3 border-t border-gray-100" />
              <p className="text-xs font-medium text-gray-500 mb-2">Apply Voucher or Promo Code</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setCodeResult(null); }}
                  placeholder="Enter code"
                  maxLength={20}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase text-gray-900 placeholder:text-gray-400 placeholder:normal-case"
                />
                <button
                  onClick={applyCode}
                  disabled={codeApplying || !codeInput.trim()}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
                >
                  {codeApplying ? "Applying..." : "Apply"}
                </button>
              </div>
              {codeResult && (
                <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${codeResult.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                  {codeResult.message}
                </div>
              )}

              {/* Resend Payment Link */}
              {isPending && Number(booking.total_amount) > 0 && (
                <button
                  onClick={resendPaymentLink}
                  disabled={resendingPayment}
                  className="mt-3 w-full rounded-lg border border-[#0f595e] bg-[#0f595e]/5 px-4 py-2.5 text-xs font-semibold text-[#0f595e] hover:bg-[#0f595e]/10 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                >
                  <PaperPlaneTilt size={14} />
                  {resendingPayment ? "Sending..." : `Resend Payment Link (${fmtCurrency(Number(booking.total_amount))})`}
                </button>
              )}
            </>
          )}
        </Card>

        {bookingAddOns.length > 0 && (
          <Card title="Add-Ons">
            {bookingAddOns.map((ao) => (
              <InfoRow
                key={ao.id}
                label={ao.add_ons?.name || "Add-on"}
                value={`${ao.qty} x ${fmtCurrency(ao.unit_price)} = ${fmtCurrency(ao.qty * ao.unit_price)}`}
              />
            ))}
            <div className="my-2 border-t border-gray-100" />
            <InfoRow
              label="Add-Ons Total"
              value={<span className="font-semibold text-gray-900">{fmtCurrency(bookingAddOns.reduce((sum, ao) => sum + ao.qty * ao.unit_price, 0))}</span>}
            />
          </Card>
        )}

        <Card title="Waiver & Intake">
          <InfoRow
            label="Waiver status"
            value={
              <Badge className={booking.waiver_status === "SIGNED" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-amber-100 text-amber-800 border-amber-200"}>
                {booking.waiver_status || "PENDING"}
              </Badge>
            }
          />
          <InfoRow label="Signed by" value={booking.waiver_signed_name || "Not signed yet"} />
          <InfoRow label="Signed at" value={booking.waiver_signed_at ? fmtDateTime(booking.waiver_signed_at) : "Not signed yet"} />
          {booking.custom_fields && Object.keys(booking.custom_fields).length > 0 ? (
            <div className="mt-3 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
              {Object.entries(booking.custom_fields).map(([key, value]) => (
                <InfoRow
                  key={key}
                  label={key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())}
                  value={String(value || "—")}
                />
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-500">No additional booking fields were captured.</p>
          )}
        </Card>

        {/* Yoco Transaction */}
        <Card title="Yoco Transaction">
          <InfoRow label="Checkout ID" value={booking.yoco_checkout_id} mono />
          <InfoRow label="Payment ID" value={booking.yoco_payment_id} mono />
          <InfoRow
            label="Payment Status"
            value={
              booking.yoco_payment_id ? (
                <Badge className="bg-green-100 text-green-800 border-green-200">Paid</Badge>
              ) : booking.yoco_checkout_id ? (
                <Badge className="bg-amber-100 text-amber-800 border-amber-200">Checkout created, awaiting payment</Badge>
              ) : (
                <span className="text-gray-400">No Yoco transaction</span>
              )
            }
          />
          {logs.filter((l) => l.event === "payment_confirmed").map((l) => {
            const p = (l.payload || {}) as Record<string, string | number | null>;
            return (
              <div key={l.id} className="mt-2 rounded-lg bg-green-50 border border-green-200 p-3 text-xs">
                <p className="font-medium text-green-800">Payment confirmed at {fmtDateTime(l.created_at)}</p>
                {p.amount != null && <p className="text-green-700 mt-1">Amount: {fmtCurrency(Number(p.amount) / 100)}</p>}
                {p.yoco_payment_id && <p className="text-green-700 font-mono">Payment ID: {String(p.yoco_payment_id)}</p>}
                {p.checkout_id && <p className="text-green-700 font-mono">Checkout ID: {String(p.checkout_id)}</p>}
              </div>
            );
          })}
          {logs.filter((l) => l.event === "payment_marked_manual").map((l) => (
            <div key={l.id} className="mt-2 rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs">
              <p className="font-medium text-blue-800">Manually marked as paid at {fmtDateTime(l.created_at)}</p>
              <p className="text-blue-700 mt-1">Recorded by admin</p>
            </div>
          ))}
        </Card>

        {/* Payment Hold (conditional) */}
        {booking.payment_deadline && (
          <Card title="Payment Hold">
            <InfoRow label="Payment Deadline" value={fmtDateTime(booking.payment_deadline)} />
            <InfoRow
              label="Status"
              value={
                isPending ? (
                  deadlineExpired ? (
                    <Badge className="bg-red-100 text-red-700 border-red-200">Expired</Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                      Expires {timeAgo(booking.payment_deadline).replace(" ago", "")} remaining
                    </Badge>
                  )
                ) : (
                  <Badge className="bg-green-100 text-green-800 border-green-200">Resolved</Badge>
                )
              }
            />
            {holds.length > 0 && (
              <>
                <div className="my-2 border-t border-gray-100" />
                <p className="text-xs font-medium text-gray-500 mb-1">Slot Holds</p>
                {holds.map((h) => (
                  <div key={h.id} className="text-xs text-gray-600 py-1">
                    <span className={`font-medium ${h.status === "CONVERTED" ? "text-green-600" : h.status === "ACTIVE" ? "text-amber-600" : "text-gray-500"}`}>
                      {h.status}
                    </span>
                    {" "} &mdash; expires {fmtDateTime(h.expires_at)} | qty: {h.qty}
                  </div>
                ))}
              </>
            )}
          </Card>
        )}

        {/* Cancellation & Refund (conditional) */}
        {(isCancelled || hasRefund) && (
          <Card title="Cancellation & Refund">
            {isCancelled && (
              <>
                <InfoRow label="Cancelled At" value={booking.cancelled_at ? fmtDateTime(booking.cancelled_at) : "—"} />
                <InfoRow label="Reason" value={booking.cancellation_reason || "No reason provided"} />
              </>
            )}
            {hasRefund && (
              <>
                {isCancelled && <div className="my-2 border-t border-gray-100" />}
                <InfoRow
                  label="Refund Status"
                  value={<Badge className={REFUND_COLORS[booking.refund_status!] || "bg-gray-100 text-gray-600"}>{booking.refund_status}</Badge>}
                />
                <InfoRow label="Refund Amount" value={booking.refund_amount ? fmtCurrency(booking.refund_amount) : "—"} />
                <InfoRow label="Refund Notes" value={booking.refund_notes} />
              </>
            )}
          </Card>
        )}
      </div>

      {/* Activity Timeline
          TODO: Extend this timeline to also pull from the `audit_logs` table to show
          all admin actions (edits, status changes, refunds, etc.) with the actor_id
          (admin user who performed the action) displayed alongside each event.
          Query: supabase.from("audit_logs").select("*").eq("booking_id", bookingId).order("created_at")
          Each audit_logs row should include actor_id which maps to admin_users.id. */}
      <Card title="Activity Timeline" className="mt-2">
        {timeline.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No activity recorded</p>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-gray-200" />

            <div className="space-y-0">
              {timeline.map((evt, i) => {
                return (
                  <div key={i} className="relative flex gap-3 py-3">
                    {/* Dot */}
                    <div className="relative z-10 flex h-3 w-3 shrink-0 mt-1.5 rounded-full bg-gray-400 border border-gray-200">
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <p className="text-sm font-medium text-gray-800">{evt.label}</p>
                        <span className="text-[10px] text-gray-400 shrink-0">{fmtDateTime(evt.time)}</span>
                      </div>
                      {evt.detail && (
                        <p className="mt-0.5 text-xs text-gray-500 break-all">{evt.detail}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
