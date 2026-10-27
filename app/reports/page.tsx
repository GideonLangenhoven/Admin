"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabase";
import { DatePicker } from "../../components/DatePicker";
import { useBusinessContext } from "../../components/BusinessContext";
import { amountReceived, amountRefunded, netReceived, derivePaymentMethod, financialTotals } from "../lib/report-accounting";
import { groupBookingPeriods, groupReportRows, type ReportPeriod } from "../lib/report-booking-periods";
import ReportPeriodGroup, { ReportPeriodPicker } from "../../components/ReportPeriodGroup";
import { fetchAllRowsResult } from "../../supabase/functions/_shared/pagination";
import { zonedToUtc } from "../lib/admin-timezone";
import { notify } from "../lib/app-notify";
import ReportsLayout, { REPORT_TABS } from "../../components/ReportsLayout";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

function fmtCurrency(n: number) {
  return "R" + Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string, timezone: string) {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: timezone });
}

function fmtTime(iso: string, timezone: string) {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone });
}

function fmtDateTime(iso: string, timezone: string) {
  return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: timezone });
}

function todayStr(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).format(new Date());
}

function monthStartStr(timezone: string) {
  const d = new Date();
  d.setDate(1);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).format(d);
}

function formatSource(raw: string | null | undefined): string {
  const key = String(raw || "").trim().toUpperCase();
  switch (key) {
    case "WEB": return "Customer Site";
    case "WEB_CHAT": return "Web Chat";
    case "ADMIN": return "Manual (Admin)";
    case "WHATSAPP":
    case "WA_WEBHOOK": return "WhatsApp";
    case "VIATOR": return "Viator";
    case "GETYOURGUIDE": return "GetYourGuide";
    case "EXTERNAL": return "Other / External";
    case "":
    case "UNKNOWN": return "Unknown";
    default: return key;
  }
}

// Status vocabulary → the shared pill classes (mono, uppercase, soft wash).
const STATUS_PILL: Record<string, string> = {
  PAID: "ui-pill-success",
  COMPLETED: "ui-pill-success",
  CONFIRMED: "ui-pill-ocean",
  PENDING: "ui-pill-warning",
  HELD: "ui-pill-amber",
  CANCELLED: "ui-pill-neutral",
  EXPIRED: "ui-pill-neutral",
};
function statusPill(status: string) {
  return `ui-status ${STATUS_PILL[status] || "ui-pill-neutral"}`;
}

function arrivedGuests(booking: { qty?: number | null; arrived_count?: number | null; checked_in?: boolean | null }) {
  const qty = Math.max(0, Number(booking.qty || 0));
  return Math.min(qty, Math.max(0, Number(booking.arrived_count ?? (booking.checked_in ? qty : 0))));
}

function attendanceLabel(booking: { qty?: number | null; arrived_count?: number | null; checked_in?: boolean | null }) {
  const qty = Math.max(0, Number(booking.qty || 0));
  const arrived = arrivedGuests(booking);
  if (qty > 0 && arrived === qty) return "Present";
  if (arrived > 0) return `${arrived}/${qty} arrived`;
  return "Not arrived";
}

// Standardized select chevron (muted ink) — matches the Dashboard's controls.
const selectChevronStyle: React.CSSProperties = {
  backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2366736B%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.75rem top 50%",
  backgroundSize: "0.6rem auto",
};

// Compact ZAR for chart value axes (exact figures stay in the tooltip).
function compactZar(n: number) {
  if (n >= 1_000_000) return "R" + (n / 1_000_000).toFixed(1) + "m";
  if (n >= 1_000) return "R" + (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return "R" + Math.round(n);
}

// Mono-label + Inter-value tooltip, styled like a ui-card.
function ChartTooltip({ active, payload, label, valueFormat }: any) {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0].value;
  return (
    <div style={{ background: "var(--ck-surface)", border: "1px solid var(--ck-border-subtle)", borderRadius: 12, boxShadow: "var(--ck-shadow-md)", padding: "8px 11px" }}>
      <div className="ui-mono-label !text-[9.5px]" style={{ marginBottom: 3 }}>{label}</div>
      <div className="text-[13px] font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
        {valueFormat ? valueFormat(Number(v)) : v}
      </div>
    </div>
  );
}

// Table header cell — mono instrument voice, hairline underline.
function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-3 text-[10.5px] font-medium uppercase tracking-[0.1em] border-b ${className}`}
      style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}
    >
      {children}
    </th>
  );
}

// Iterate calendar days as strings (noon-UTC anchor avoids DST/boundary drift).
function addDaysStr(ymd: string, n: number) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function Reports() {
  return <Suspense fallback={<div className="ui-skeleton h-24" />}><ReportsContent /></Suspense>;
}

function ReportsContent() {
  const searchParams = useSearchParams();
  const { businessId, businessName, timezone } = useBusinessContext();
  const activeTimezone = timezone || "UTC";
  const [bookings, setBookings] = useState<any[]>([]);
  const [reportTruncated, setReportTruncated] = useState(false);
  const [reportError, setReportError] = useState("");
  const loadRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const [signedInPeriod, setSignedInPeriod] = useState(0);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(() => monthStartStr(activeTimezone));
  const [endDate, setEndDate] = useState(() => todayStr(activeTimezone));
  // Default to booking date (money received) — the tour-date view hides
  // future-dated bookings inside the current window and reads as "revenue
  // missing" (matches the dashboard's payment-date semantics).
  const [filterBy, setFilterBy] = useState<"slot" | "created">("created");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [bookingPeriod, setBookingPeriod] = useState<ReportPeriod>("week");
  const activeTab = REPORT_TABS.find(tab => tab.key === searchParams.get("tab"))?.key || "bookings";

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setStartDate(monthStartStr(activeTimezone));
    setEndDate(todayStr(activeTimezone));
  }, [activeTimezone]);

  async function loadReport() {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setReportError("");
    setBookings([]);
    setSignedInPeriod(0);
    setReportTruncated(false);
    try {
      const startIso = new Date(zonedToUtc(startDate + "T00:00:00", activeTimezone)).toISOString();
      const endIso = new Date(zonedToUtc(addDaysStr(endDate, 1) + "T00:00:00", activeTimezone)).toISOString();
      const slotRelation = filterBy === "slot" ? "slots!inner(start_time)" : "slots(start_time)";

      // Page through the full result set so revenue/attendance/CSV totals cover
      // every booking in range. A single `.limit(2000)` silently understated
      // revenue for any tenant with >2000 bookings in the period. Downstream
      // revenue logic is unchanged — it just now sees the complete set. A high
      // safety ceiling caps browser memory for pathological ranges; if hit, the
      // report is flagged as truncated rather than silently wrong.
      const PAGE = 1000;
      const CEILING = 20000;
      const rows: any[] = [];
      let truncated = false;
      for (let from = 0; from < CEILING; from += PAGE) {
        let query = supabase
          .from("bookings")
          .select("id, customer_name, phone, email, qty, unit_price, total_amount, original_total, discount_type, discount_percent, discount_amount, status, yoco_payment_id, payfast_m_payment_id, source, created_at, arrived_count, checked_in, checked_in_at, waiver_status, waiver_signed_at, waiver_signed_name, total_captured, total_refunded, refund_amount, refund_status, refund_processed_at, payment_method, voucher_code, voucher_amount_paid, promo_code, is_combo, ota_channel, ota_gross_amount, ota_net_amount, cancelled_at, cancellation_reason, created_by_admin_name, customer_vat_number, allow_unpaid, tours(name), " + slotRelation)
          .eq("business_id", businessId);
        if (filterBy === "slot") {
          query = query.eq("slots.business_id", businessId).gte("slots.start_time", startIso).lt("slots.start_time", endIso);
        } else {
          query = query.gte("created_at", startIso).lt("created_at", endIso);
        }
        const { data, error } = await query.order("created_at", { ascending: false }).order("id").range(from, from + PAGE - 1);
        if (requestId !== loadRequestRef.current) return;
        if (error) throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE) break;
        if (from + PAGE >= CEILING) truncated = true;
      }
      setReportTruncated(truncated);
      setBookings(rows.map((b: any) => ({
        ...b,
        tours: Array.isArray(b.tours) ? b.tours[0] || null : b.tours,
        slots: Array.isArray(b.slots) ? b.slots[0] || null : b.slots,
      })));

      // Separately count waivers SIGNED in the period (by signing date, not trip
      // date). The default query above filters by slot.start_time, so a waiver
      // signed in May for a trip in March wouldn't appear. This independent
      // count answers "did we sign any waivers in this window?" honestly.
      const { count: signedCount, error: countError } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("waiver_status", "SIGNED")
        .gte("waiver_signed_at", startIso)
        .lt("waiver_signed_at", endIso);
      if (requestId !== loadRequestRef.current) return;
      if (countError) throw countError;
      setSignedInPeriod(signedCount || 0);
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      console.error("Report load error:", error);
      setBookings([]);
      setReportError("Report incomplete. Retry before using totals or exports.");
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    return () => { loadRequestRef.current++; };
  }, [startDate, endDate, filterBy, businessId, activeTimezone]);

  const filtered = useMemo(() => {
    const rows = filterStatus === "ALL" ? bookings : bookings.filter(b => b.status === filterStatus);
    return [...rows].sort((a, b) => String(a.slots?.start_time || a.created_at).localeCompare(String(b.slots?.start_time || b.created_at)));
  }, [bookings, filterStatus]);

  const bookingPeriods = useMemo(() => activeTab === "bookings" ? groupBookingPeriods(filtered, bookingPeriod, filterBy, activeTimezone) : [], [activeTab, filtered, bookingPeriod, filterBy, activeTimezone]);

  const summary = useMemo(() => {
    const paid = filtered.filter(b => ["PAID", "COMPLETED", "CONFIRMED"].includes(b.status));
    const active = filtered.filter(b => b.status !== "CANCELLED");
    return {
      total: filtered.length,
      pax: filtered.reduce((s, b) => s + Number(b.qty || 0), 0),
      revenue: paid.reduce((s, b) => s + Number(b.total_amount || 0), 0),
      cancelled: filtered.filter(b => b.status === "CANCELLED").length,
      waiverSigned: active.filter(b => b.waiver_status === "SIGNED").length,
      waiverPending: active.filter(b => b.waiver_status !== "SIGNED").length,
    };
  }, [filtered]);

  // Accounting truth for the Financials tab: cash actually received/refunded
  // per the captured/refund columns, not booked totals by status.
  const fin = useMemo(() => financialTotals(filtered), [filtered]);

  // Receipts follow the same date filter and accounting rules as Financials.
  const revenueSeries = useMemo(() => {
    if (activeTab !== "financials" || !startDate || !endDate || endDate < startDate) return [];
    const dayOf = (iso: string) =>
      new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: activeTimezone }).format(new Date(iso));

    const spanDays = Math.round((new Date(endDate + "T12:00:00Z").getTime() - new Date(startDate + "T12:00:00Z").getTime()) / 86_400_000) + 1;
    const byMonth = spanDays > 92;

    const buckets = new Map<string, number>();
    let cursor = startDate;
    let guard = 0;
    while (cursor <= endDate && guard < 800) {
      buckets.set(byMonth ? cursor.slice(0, 7) : cursor, 0);
      cursor = addDaysStr(cursor, 1);
      guard++;
    }

    for (const b of filtered) {
      const iso = filterBy === "slot" ? (b.slots?.start_time || b.created_at) : b.created_at;
      if (!iso) continue;
      const day = dayOf(iso);
      const key = byMonth ? day.slice(0, 7) : day;
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + amountReceived(b));
    }

    const labelOf = (key: string) => {
      if (byMonth) {
        const [y, m] = key.split("-").map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
      }
      const [y, m, d] = key.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
    };

    return Array.from(buckets, ([key, revenue]) => ({ key, label: labelOf(key), revenue }));
  }, [activeTab, filtered, filterBy, startDate, endDate, activeTimezone]);

  const hasRevenue = revenueSeries.some(d => d.revenue > 0);
  const reportGenDate = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: activeTimezone });
  const csvPrefix = businessName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();

  function buildCSV(title: string, headers: string[], rows: any[][]) {
    const meta = [
      [title],
      ["Company", businessName],
      ["Period", startDate + " to " + endDate],
      ["Generated", reportGenDate],
      [],
    ];
    const csv = [...meta, headers, ...rows]
      .map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    return "﻿" + csv;
  }

  function triggerDownload(content: string, filename: string) {
    if (!mountedRef.current) return;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadCSV() {
    if (activeTab === "attendance") {
      const activeBookings = filtered.filter(b => b.status !== "CANCELLED");
      const headers = ["Tour Date", "Time", "Tour", "Customer", "Phone", "Pax", "Arrived", "Fully Checked In", "Checked In At", "Status"];
      const rows = activeBookings.map(b => [
        b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "",
        b.slots?.start_time ? fmtTime(b.slots.start_time, activeTimezone) : "",
        b.tours?.name || "",
        b.customer_name || "",
        b.phone || "",
        b.qty || 0,
        arrivedGuests(b),
        b.checked_in ? "Yes" : "No",
        b.checked_in_at ? fmtDateTime(b.checked_in_at, activeTimezone) : "",
        b.status || ""
      ]);
      triggerDownload(buildCSV("Attendance Report", headers, rows), `${csvPrefix}-attendance-${startDate}-to-${endDate}.csv`);
      return;
    }

    if (activeTab === "financials") {
      // Full transaction ledger: every money column an accountant needs to
      // reconcile receipts, refunds and outstanding balances per booking,
      // with the references to trace each amount to the payment gateway.
      const headers = [
        "Transaction Date", "Booking Ref", "Booking ID", "Status", "Customer Name", "Customer VAT No",
        "Tour", "Tour Date", "Source", "Qty", "Unit Price",
        "Subtotal", "Discount", "Discount Type", "Promo Code", "Total Due",
        "Voucher Code", "Voucher Applied", "Amount Received", "Refunded", "Net Received", "Outstanding",
        "Payment Method", "Gateway Ref (Yoco)", "Gateway Ref (PayFast)", "OTA Channel", "OTA Gross", "OTA Net",
        "Refund Status", "Refund Processed At", "Cancelled At", "Cancellation Reason", "Booked By",
      ];
      const rows = filtered.map(b => {
        const due = Number(b.total_amount || 0);
        const received = amountReceived(b);
        const refunded = amountRefunded(b);
        return [
          fmtDateTime(b.created_at, activeTimezone),
          b.id.substring(0, 8).toUpperCase(),
          b.id,
          b.status || "",
          b.customer_name || "",
          b.customer_vat_number || "",
          b.tours?.name || "",
          b.slots?.start_time ? fmtDateTime(b.slots.start_time, activeTimezone) : "",
          b.source || "",
          b.qty || 0,
          Number(b.unit_price || 0).toFixed(2),
          Number(b.original_total || b.total_amount || 0).toFixed(2),
          Number((b.original_total || b.total_amount || 0) - due).toFixed(2),
          b.discount_type || "",
          b.promo_code || "",
          due.toFixed(2),
          b.voucher_code || "",
          Number(b.voucher_amount_paid || 0).toFixed(2),
          received.toFixed(2),
          refunded.toFixed(2),
          (received - refunded).toFixed(2),
          (["CANCELLED", "EXPIRED"].includes(b.status) ? 0 : Math.max(0, due - received)).toFixed(2),
          derivePaymentMethod(b),
          b.yoco_payment_id || "",
          b.payfast_m_payment_id || "",
          b.ota_channel || "",
          b.ota_gross_amount != null ? Number(b.ota_gross_amount).toFixed(2) : "",
          b.ota_net_amount != null ? Number(b.ota_net_amount).toFixed(2) : "",
          b.refund_status || "",
          b.refund_processed_at ? fmtDateTime(b.refund_processed_at, activeTimezone) : "",
          b.cancelled_at ? fmtDateTime(b.cancelled_at, activeTimezone) : "",
          b.cancellation_reason || "",
          b.created_by_admin_name || "",
        ];
      });
      const totals = [
        [],
        ["TOTALS"],
        ["Gross booked (live bookings)", fin.grossBooked.toFixed(2)],
        ["Discounts given", fin.discounts.toFixed(2)],
        ["Amount received", fin.received.toFixed(2)],
        ["of which voucher redemptions", fin.voucherApplied.toFixed(2)],
        ["Refunded", fin.refunded.toFixed(2)],
        ["Net received", fin.net.toFixed(2)],
        ["Outstanding", fin.outstanding.toFixed(2)],
      ];
      triggerDownload(buildCSV("Financial Ledger", headers, [...rows, ...totals]), `${csvPrefix}-financial-ledger-${startDate}-to-${endDate}.csv`);
      return;
    }

    if (activeTab === "marketing") {
      const marketingData = Object.values(
        filtered.reduce((acc: any, b: any) => {
          const src = formatSource(b.source);
          if (!acc[src]) acc[src] = { source: src, count: 0, pax: 0, revenue: 0 };
          acc[src].count++;
          acc[src].pax += b.qty;
          if (["PAID", "COMPLETED", "CONFIRMED"].includes(b.status)) {
            acc[src].revenue += Number(b.total_amount || 0);
          }
          return acc;
        }, {})
      );

      const headers = ["Source", "Total Bookings", "Total Pax", "Revenue Generated", "Avg. Order Value"];
      const rows = marketingData.map((d: any) => [
        d.source,
        d.count,
        d.pax,
        Number(d.revenue).toFixed(2),
        Number(d.count > 0 ? d.revenue / d.count : 0).toFixed(2)
      ]);
      triggerDownload(buildCSV("Marketing Report", headers, rows), `${csvPrefix}-marketing-${startDate}-to-${endDate}.csv`);
      return;
    }

    if (activeTab === "waivers") {
      const active = filtered.filter(b => b.status !== "CANCELLED");
      const headers = ["Ref", "Tour Date", "Customer", "Phone", "Email", "Tour", "Pax", "Waiver Status", "Signed By", "Signed At", "Booking Status"];
      const rows = active.map(b => [
        b.id.substring(0, 8).toUpperCase(),
        b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "",
        b.customer_name || "",
        b.phone || "",
        b.email || "",
        b.tours?.name || "",
        b.qty || 0,
        b.waiver_status === "SIGNED" ? "SIGNED" : "PENDING",
        b.waiver_signed_name || "",
        b.waiver_signed_at ? fmtDateTime(b.waiver_signed_at, activeTimezone) : "",
        b.status || "",
      ]);
      triggerDownload(buildCSV("Waiver Report", headers, rows), `${csvPrefix}-waivers-${startDate}-to-${endDate}.csv`);
      return;
    }

    const headers = ["Period", "Bookings", "Guests"];
    const rows = bookingPeriods.map(group => [group.label, group.bookings, group.guests]);
    triggerDownload(buildCSV(`Bookings by ${bookingPeriod}`, headers, rows), `${csvPrefix}-bookings-${bookingPeriod}-${startDate}-to-${endDate}.csv`);
  }

  // ── Accounting registers (on-demand fetch + CSV; financials tab only) ──
  const [registerBusy, setRegisterBusy] = useState<string | null>(null);

  function registerFailed(error: unknown) {
    console.error("Register load error:", error);
    if (mountedRef.current) notify({ title: "Register could not be loaded", message: "Please retry. No partial export was downloaded.", tone: "error" });
  }

  async function downloadRefundRegister() {
    setRegisterBusy("refunds");
    const startIso = new Date(zonedToUtc(startDate + "T00:00:00", activeTimezone)).toISOString();
    const endIso = new Date(zonedToUtc(addDaysStr(endDate, 1) + "T00:00:00", activeTimezone)).toISOString();
    // Money truth lives on bookings; refund_requests is workflow. A refund
    // belongs to this period when it was PROCESSED in it (or, for legacy rows
    // without a processed date, when the booking was cancelled in it).
    const { data, error } = await fetchAllRowsResult((from, to) => supabase
      .from("bookings")
      .select("id, created_at, customer_name, email, total_amount, total_captured, total_refunded, refund_amount, refund_status, refund_processed_at, refund_notes, cancelled_at, cancellation_reason, yoco_payment_id, status, tours(name)")
      .eq("business_id", businessId)
      .or(`and(refund_processed_at.gte.${startIso},refund_processed_at.lt.${endIso}),and(refund_processed_at.is.null,total_refunded.gt.0,cancelled_at.gte.${startIso},cancelled_at.lt.${endIso})`)
      .order("id").range(from, to));
    setRegisterBusy(null);
    if (error) { registerFailed(error); return; }
    const rows = (data || [])
      .map((b: any) => ({ ...b, tours: Array.isArray(b.tours) ? b.tours[0] || null : b.tours }))
      .sort((a: any, z: any) => String(a.refund_processed_at || a.cancelled_at || "").localeCompare(String(z.refund_processed_at || z.cancelled_at || "")));
    const headers = ["Refund Date", "Booking Ref", "Booking ID", "Customer", "Tour", "Booking Status", "Amount Received", "Amount Refunded", "Refund Status", "Gateway Ref", "Cancelled At", "Reason", "Notes"];
    const csvRows = rows.map((b: any) => [
      b.refund_processed_at ? fmtDateTime(b.refund_processed_at, activeTimezone) : (b.cancelled_at ? fmtDateTime(b.cancelled_at, activeTimezone) : ""),
      b.id.substring(0, 8).toUpperCase(),
      b.id,
      b.customer_name || "",
      b.tours?.name || "",
      b.status || "",
      amountReceived(b).toFixed(2),
      amountRefunded(b).toFixed(2),
      b.refund_status || "",
      b.yoco_payment_id || "",
      b.cancelled_at ? fmtDateTime(b.cancelled_at, activeTimezone) : "",
      b.cancellation_reason || "",
      b.refund_notes || "",
    ]);
    const total = rows.reduce((s: number, b: any) => s + amountRefunded(b), 0);
    triggerDownload(buildCSV("Refund Register", headers, [...csvRows, [], ["Total refunded", total.toFixed(2)]]), `${csvPrefix}-refund-register-${startDate}-to-${endDate}.csv`);
  }

  async function downloadInvoiceRegister() {
    setRegisterBusy("invoices");
    const startIso = new Date(zonedToUtc(startDate + "T00:00:00", activeTimezone)).toISOString();
    const endIso = new Date(zonedToUtc(addDaysStr(endDate, 1) + "T00:00:00", activeTimezone)).toISOString();
    const { data, error } = await fetchAllRowsResult((from, to) => supabase
      .from("invoices")
      .select("invoice_number, created_at, customer_name, customer_email, customer_company_name, customer_vat_number, tour_name, tour_date, qty, unit_price, subtotal, discount_type, discount_amount, total_amount, payment_method, payment_reference, voucher_code, status, booking_id")
      .eq("business_id", businessId)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("invoice_number", { ascending: true })
      .order("id").range(from, to));
    setRegisterBusy(null);
    if (error) { registerFailed(error); return; }
    const rows = data || [];
    const headers = ["Invoice No", "Issued At", "Customer", "Company", "VAT No", "Email", "Tour", "Tour Date", "Qty", "Unit Price", "Subtotal", "Discount", "Total", "Payment Method", "Payment Reference", "Voucher", "Status", "Booking Ref"];
    const csvRows = rows.map((inv: any) => [
      inv.invoice_number || "",
      fmtDateTime(inv.created_at, activeTimezone),
      inv.customer_name || "",
      inv.customer_company_name || "",
      inv.customer_vat_number || "",
      inv.customer_email || "",
      inv.tour_name || "",
      inv.tour_date || "",
      inv.qty || 0,
      Number(inv.unit_price || 0).toFixed(2),
      Number(inv.subtotal || 0).toFixed(2),
      Number(inv.discount_amount || 0).toFixed(2),
      Number(inv.total_amount || 0).toFixed(2),
      inv.payment_method || "",
      inv.payment_reference || "",
      inv.voucher_code || "",
      inv.status || "",
      inv.booking_id ? String(inv.booking_id).substring(0, 8).toUpperCase() : "",
    ]);
    const total = rows.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0);
    triggerDownload(buildCSV("Invoice Register", headers, [...csvRows, [], ["Invoices", rows.length], ["Total invoiced", total.toFixed(2)]]), `${csvPrefix}-invoice-register-${startDate}-to-${endDate}.csv`);
  }

  async function downloadVoucherRegister() {
    setRegisterBusy("vouchers");
    const startIso = new Date(zonedToUtc(startDate + "T00:00:00", activeTimezone)).toISOString();
    const endIso = new Date(zonedToUtc(addDaysStr(endDate, 1) + "T00:00:00", activeTimezone)).toISOString();
    // Three sections in one register: sold in period (income received),
    // redeemed in period (liability released), and the open-balance snapshot
    // (current liability, as of now, independent of the date range).
    const [sold, redeemed, open] = await Promise.all([
      fetchAllRowsResult((from, to) => supabase.from("vouchers")
        .select("code, created_at, buyer_name, buyer_email, recipient_name, purchase_amount, value, current_balance, status, expires_at")
        .eq("business_id", businessId).gte("created_at", startIso).lt("created_at", endIso)
        .order("created_at").order("id").range(from, to)),
      fetchAllRowsResult((from, to) => supabase.from("vouchers")
        .select("code, redeemed_at, buyer_name, recipient_name, value, current_balance, status, redeemed_booking_id")
        .eq("business_id", businessId).gte("redeemed_at", startIso).lt("redeemed_at", endIso)
        .order("redeemed_at").order("id").range(from, to)),
      fetchAllRowsResult((from, to) => supabase.from("vouchers")
        .select("code, created_at, buyer_name, recipient_name, value, current_balance, status, expires_at")
        .eq("business_id", businessId).gt("current_balance", 0).eq("status", "ACTIVE")
        .order("created_at").order("id").range(from, to)),
    ]);
    setRegisterBusy(null);
    if (sold.error || redeemed.error || open.error) {
      registerFailed(sold.error || redeemed.error || open.error);
      return;
    }
    const headers = ["Section", "Code", "Date", "Buyer", "Recipient", "Face Value", "Purchase Amount", "Current Balance", "Status", "Expires / Booking"];
    const csvRows: any[][] = [];
    for (const v of sold.data || []) {
      csvRows.push(["SOLD", v.code, fmtDateTime(v.created_at, activeTimezone), v.buyer_name || "", v.recipient_name || "", Number(v.value || 0).toFixed(2), Number(v.purchase_amount || v.value || 0).toFixed(2), Number(v.current_balance || 0).toFixed(2), v.status || "", v.expires_at ? fmtDate(v.expires_at, activeTimezone) : ""]);
    }
    for (const v of redeemed.data || []) {
      csvRows.push(["REDEEMED", v.code, v.redeemed_at ? fmtDateTime(v.redeemed_at, activeTimezone) : "", v.buyer_name || "", v.recipient_name || "", Number(v.value || 0).toFixed(2), "", Number(v.current_balance || 0).toFixed(2), v.status || "", v.redeemed_booking_id ? String(v.redeemed_booking_id).substring(0, 8).toUpperCase() : ""]);
    }
    for (const v of open.data || []) {
      csvRows.push(["OPEN BALANCE", v.code, fmtDateTime(v.created_at, activeTimezone), v.buyer_name || "", v.recipient_name || "", Number(v.value || 0).toFixed(2), "", Number(v.current_balance || 0).toFixed(2), v.status || "", v.expires_at ? fmtDate(v.expires_at, activeTimezone) : ""]);
    }
    const soldTotal = (sold.data || []).reduce((s: number, v: any) => s + Number(v.purchase_amount || v.value || 0), 0);
    const liability = (open.data || []).reduce((s: number, v: any) => s + Number(v.current_balance || 0), 0);
    triggerDownload(
      buildCSV("Voucher Register", headers, [...csvRows, [], ["Sold in period (received)", soldTotal.toFixed(2)], ["Open voucher liability (as of today)", liability.toFixed(2)]]),
      `${csvPrefix}-voucher-register-${startDate}-to-${endDate}.csv`,
    );
  }

  async function downloadSettlementRegister() {
    setRegisterBusy("settlements");
    const { data, error } = await fetchAllRowsResult((from, to) => supabase
      .from("combo_settlements")
      .select("period_start, period_end, collector_business_id, owed_business_id, total_collected, amount_owed, combo_booking_count, status, settled_at, notes, created_at")
      .or(`collector_business_id.eq.${businessId},owed_business_id.eq.${businessId}`)
      .gte("period_end", startDate)
      .lte("period_start", endDate)
      .order("period_start")
      .order("id").range(from, to));
    if (error) { setRegisterBusy(null); registerFailed(error); return; }
    const rows = data || [];
    // Keep lookup URLs bounded even for large partner networks.
    const otherIds = Array.from(new Set(rows.flatMap((r: any) => [r.collector_business_id, r.owed_business_id]).filter((id: string) => id && id !== businessId)));
    const names: Record<string, string> = {};
    for (let from = 0; from < otherIds.length; from += 200) {
      const { data: biz } = await supabase.from("businesses").select("id, name").in("id", otherIds.slice(from, from + 200));
      Object.assign(names, Object.fromEntries((biz || []).map((b: any) => [b.id, b.name])));
    }
    setRegisterBusy(null);
    const headers = ["Period", "Direction", "Counterparty", "Combo Bookings", "Total Collected", "Amount Owed", "Status", "Settled At", "Notes"];
    const csvRows = rows.map((r: any) => {
      const iCollect = r.collector_business_id === businessId;
      const counterpartyId = iCollect ? r.owed_business_id : r.collector_business_id;
      return [
        r.period_start + " to " + r.period_end,
        iCollect ? "PAYABLE (we collected)" : "RECEIVABLE (they collected)",
        names[counterpartyId] || counterpartyId || "",
        r.combo_booking_count || 0,
        Number(r.total_collected || 0).toFixed(2),
        Number(r.amount_owed || 0).toFixed(2),
        r.status || "",
        r.settled_at ? fmtDateTime(r.settled_at, activeTimezone) : "",
        r.notes || "",
      ];
    });
    const payable = rows.filter((r: any) => r.collector_business_id === businessId).reduce((s: number, r: any) => s + Number(r.amount_owed || 0), 0);
    const receivable = rows.filter((r: any) => r.owed_business_id === businessId).reduce((s: number, r: any) => s + Number(r.amount_owed || 0), 0);
    triggerDownload(
      buildCSV("Combo Settlement Register", headers, [...csvRows, [], ["Total payable to partners", payable.toFixed(2)], ["Total receivable from partners", receivable.toFixed(2)]]),
      `${csvPrefix}-settlement-register-${startDate}-to-${endDate}.csv`,
    );
  }

  async function downloadPDF() {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF("landscape");

    let title = "";
    let headers: string[] = [];
    let rows: any[][] = [];

    if (activeTab === "attendance") {
      const activeBookings = filtered.filter(b => b.status !== "CANCELLED");
      title = `Attendance Report (${startDate} to ${endDate})`;
      headers = ["Date", "Time", "Tour", "Customer", "Pax", "Arrived", "Fully Checked In", "Status"];
      rows = activeBookings.map(b => [
        b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "—",
        b.slots?.start_time ? fmtTime(b.slots.start_time, activeTimezone) : "—",
        b.tours?.name || "—",
        b.customer_name || "—",
        b.qty,
        arrivedGuests(b),
        b.checked_in ? "Yes" : "No",
        b.status
      ]);
    } else if (activeTab === "financials") {
      title = `Financial Report (${startDate} to ${endDate})`;
      headers = ["Date", "Booking Ref", "Customer", "Method", "Total Due", "Received", "Refunded", "Net", "Status"];
      rows = filtered.map(b => [
        fmtDateTime(b.created_at, activeTimezone),
        b.id.substring(0, 8).toUpperCase(),
        b.customer_name || "—",
        derivePaymentMethod(b) || "—",
        fmtCurrency(Number(b.total_amount || 0)),
        fmtCurrency(amountReceived(b)),
        fmtCurrency(amountRefunded(b)),
        fmtCurrency(netReceived(b)),
        b.status
      ]);
      rows.push(["", "", "", "TOTALS", fmtCurrency(fin.grossBooked), fmtCurrency(fin.received), fmtCurrency(fin.refunded), fmtCurrency(fin.net), ""]);
    } else if (activeTab === "marketing") {
      title = `Marketing Report (${startDate} to ${endDate})`;
      headers = ["Source", "Bookings", "Total Pax", "Revenue", "Avg. Order Value"];

      const marketingData = Object.values(
        filtered.reduce((acc: any, b: any) => {
          const src = formatSource(b.source);
          if (!acc[src]) acc[src] = { source: src, count: 0, pax: 0, revenue: 0 };
          acc[src].count++;
          acc[src].pax += b.qty;
          if (["PAID", "COMPLETED", "CONFIRMED"].includes(b.status)) {
            acc[src].revenue += Number(b.total_amount || 0);
          }
          return acc;
        }, {})
      );

      rows = marketingData.map((d: any) => [
        d.source,
        d.count,
        d.pax,
        fmtCurrency(d.revenue),
        fmtCurrency(d.count > 0 ? d.revenue / d.count : 0)
      ]);
    } else if (activeTab === "waivers") {
      title = `Waiver Report (${startDate} to ${endDate})`;
      headers = ["Ref", "Tour Date", "Customer", "Tour", "Pax", "Waiver Status", "Signed By", "Booking Status"];
      const active = filtered.filter(b => b.status !== "CANCELLED");
      rows = active.map(b => [
        b.id.substring(0, 8).toUpperCase(),
        b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "—",
        b.customer_name || "—",
        b.tours?.name || "—",
        b.qty,
        b.waiver_status === "SIGNED" ? "✓ Signed" : "Pending",
        b.waiver_signed_name || "—",
        b.status,
      ]);
    } else {
      title = `Bookings by ${bookingPeriod} (${startDate} to ${endDate})`;
      headers = ["Period", "Bookings", "Guests"];
      rows = bookingPeriods.map(group => [group.label, group.bookings, group.guests]);
    }

    // Company header
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(businessName, 14, 14);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text(title, 14, 22);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text("Generated: " + reportGenDate, 14, 28);
    doc.setTextColor(0, 0, 0);

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: 32,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [4, 120, 87] },
    });

    if (mountedRef.current) doc.save(`${csvPrefix}-${activeTab}-${startDate}-to-${endDate}.pdf`);
  }

  return (
    <ReportsLayout activeTab={activeTab}
      actions={<>
        <button data-demo-action="report.csv" onClick={downloadCSV} disabled={loading || filtered.length === 0} className="ui-btn ui-btn-primary disabled:opacity-40">
          CSV
        </button>
        <button data-demo-action="report.pdf" onClick={downloadPDF} disabled={loading || filtered.length === 0} className="ui-btn ui-btn-ghost disabled:opacity-40">
          PDF
        </button>
      </>}>
      {reportError && (
        <div role="alert" className="rounded-md px-3 py-2 text-[13px]" style={{ background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }}>
          {reportError} <button type="button" onClick={loadReport} className="underline">Retry</button>
        </div>
      )}
      {reportTruncated && (
        <div className="rounded-md px-3 py-2 text-[13px]" style={{ background: "var(--ck-warn-soft, #fef3c7)", color: "var(--ck-warn-strong, #92400e)" }}>
          20,000-booking limit reached. Totals and exports are partial; choose a smaller date range.
        </div>
      )}
      {/* ── Filters ── */}
      <div className="ui-card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1.5 sm:min-w-[150px]">
          <span className="ui-mono-label !text-[10px]">Filter by</span>
          <select
            value={filterBy}
            onChange={e => setFilterBy(e.target.value as "slot" | "created")}
            className="ui-control w-full appearance-none pr-9"
            style={selectChevronStyle}
          >
            <option value="slot">Tour date</option>
            <option value="created">Booking date</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 sm:min-w-[150px]">
          <span className="ui-mono-label !text-[10px]">From</span>
          <DatePicker value={startDate} onChange={setStartDate} />
        </label>
        <label className="flex flex-col gap-1.5 sm:min-w-[150px]">
          <span className="ui-mono-label !text-[10px]">To</span>
          <DatePicker alignRight={true} value={endDate} onChange={setEndDate} />
        </label>
        <label className="flex flex-col gap-1.5 sm:min-w-[160px]">
          <span className="ui-mono-label !text-[10px]">Status</span>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="ui-control w-full appearance-none pr-9"
            style={selectChevronStyle}
          >
            <option value="ALL">All Statuses</option>
            <option value="PAID">PAID</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="PENDING">PENDING</option>
            <option value="HELD">HELD</option>
            <option value="CANCELLED">CANCELLED</option>
            <option value="EXPIRED">EXPIRED</option>
          </select>
        </label>
        <button onClick={loadReport} className="ui-btn ui-btn-ghost sm:ml-auto">
          Refresh
        </button>
      </div>

      {/* ── Summary tiles ── */}
      {activeTab === "waivers" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Active Bookings", value: summary.total - summary.cancelled, color: "var(--ck-text-strong)", hint: "trip date in range" },
            { label: "Signed (trip in range)", value: summary.waiverSigned, color: "var(--ck-success)", hint: "signed waivers for trips in this period" },
            { label: "Signed in this period", value: signedInPeriod, color: "var(--ck-success)", hint: "by signing date, independent of trip date" },
            { label: "Waivers Pending", value: summary.waiverPending, color: summary.waiverPending > 0 ? "var(--ck-warning)" : "var(--ck-text-strong)", hint: "trips in range, no waiver yet" },
            { label: "Compliance", value: (summary.waiverSigned + summary.waiverPending) > 0 ? Math.round((summary.waiverSigned / (summary.waiverSigned + summary.waiverPending)) * 100) + "%" : "—", color: "var(--ck-text-strong)" },
          ].map(c => (
            <div key={c.label} className="ui-card p-4" title={c.hint || c.label}>
              <p className="ui-mono-label !text-[10px]">{c.label}</p>
              <p className="font-display mt-1.5 text-[26px] font-semibold leading-none tabular-nums" style={{ color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>
      ) : activeTab === "financials" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: "Gross Booked", value: fmtCurrency(fin.grossBooked), color: "var(--ck-text-strong)", hint: "total due on live bookings (excl. cancelled/expired)" },
              { label: "Received", value: fmtCurrency(fin.received), color: "var(--ck-success)", hint: "cash + voucher value actually captured" },
              { label: "Refunded", value: fmtCurrency(fin.refunded), color: fin.refunded > 0 ? "var(--ck-danger)" : "var(--ck-text-strong)", hint: "processed refunds" },
              { label: "Net Received", value: fmtCurrency(fin.net), color: "var(--ck-success)", hint: "received minus refunded" },
              { label: "Outstanding", value: fmtCurrency(fin.outstanding), color: fin.outstanding > 0 ? "var(--ck-warning)" : "var(--ck-text-strong)", hint: "due but not yet received on live bookings" },
            ].map(c => (
              <div key={c.label} className="ui-card p-4" title={c.hint}>
                <p className="ui-mono-label !text-[10px]">{c.label}</p>
                <p className="font-display mt-1.5 text-[26px] font-semibold leading-none tabular-nums" style={{ color: c.color }}>{c.value}</p>
              </div>
            ))}
          </div>
          {(fin.voucherApplied > 0 || fin.missingGatewayRef > 0) && (
            <p className="px-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>
              {fin.voucherApplied > 0 && <>Includes {fmtCurrency(fin.voucherApplied)} paid by voucher redemption. </>}
              {fin.missingGatewayRef > 0 && <span style={{ color: "var(--ck-warning)" }}>{fin.missingGatewayRef} paid booking{fin.missingGatewayRef === 1 ? " has" : "s have"} no payment reference recorded (audit flag).</span>}
            </p>
          )}
          <div className="ui-card flex flex-wrap items-center gap-2 p-3">
            <span className="ui-mono-label !text-[10px] mr-1">Accounting registers</span>
            <button data-demo-action="report.refunds" onClick={downloadRefundRegister} disabled={registerBusy !== null} className="ui-btn ui-btn-ghost !h-8 !px-3 !text-xs disabled:opacity-40">
              {registerBusy === "refunds" ? "Building…" : "Refunds CSV"}
            </button>
            <button data-demo-action="report.invoices" onClick={downloadInvoiceRegister} disabled={registerBusy !== null} className="ui-btn ui-btn-ghost !h-8 !px-3 !text-xs disabled:opacity-40">
              {registerBusy === "invoices" ? "Building…" : "Invoices CSV"}
            </button>
            <button data-demo-action="report.vouchers" onClick={downloadVoucherRegister} disabled={registerBusy !== null} className="ui-btn ui-btn-ghost !h-8 !px-3 !text-xs disabled:opacity-40">
              {registerBusy === "vouchers" ? "Building…" : "Vouchers CSV"}
            </button>
            <button data-demo-action="report.settlements" onClick={downloadSettlementRegister} disabled={registerBusy !== null} className="ui-btn ui-btn-ghost !h-8 !px-3 !text-xs disabled:opacity-40">
              {registerBusy === "settlements" ? "Building…" : "Combo Settlements CSV"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Revenue over time — Financials only ── */}
      {activeTab === "financials" && <div className="ui-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Revenue over time</h3>
            <p className="ui-mono-label mt-1 !text-[10px]">Received · {filterBy === "slot" ? "by tour date" : "by booking date"}</p>
          </div>
          <span className="font-display text-[22px] font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{fmtCurrency(fin.received)}</span>
        </div>
        {hasRevenue ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={revenueSeries} margin={{ top: 6, right: 12, left: -6, bottom: 0 }}>
              <defs>
                <linearGradient id="rev-area-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: "var(--ck-chart-1)", stopOpacity: 0.18 }} />
                  <stop offset="100%" style={{ stopColor: "var(--ck-chart-1)", stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--ck-chart-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10.5, fontFamily: "var(--font-mono)", fill: "var(--ck-text-muted)" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tickFormatter={compactZar}
                tick={{ fontSize: 10.5, fontFamily: "var(--font-mono)", fill: "var(--ck-text-muted)" }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip cursor={{ stroke: "var(--ck-border-strong)", strokeDasharray: "3 3" }} content={<ChartTooltip valueFormat={fmtCurrency} />} />
              <Area type="monotone" dataKey="revenue" stroke="var(--ck-chart-1)" strokeWidth={2} fill="url(#rev-area-grad)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="ui-empty">
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No payments in this period</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>No payments received in this range.</p>
          </div>
        )}
      </div>}

      {/* ── Table ── */}
      {loading ? (
        <div className="ui-card space-y-2.5 p-4">
          <div className="ui-skeleton h-9 w-full" />
          {Array.from({ length: 7 }).map((_, i) => <div key={i} className="ui-skeleton h-11 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="ui-card">
          <div className="ui-empty">
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No records found</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Nothing matches this period and filter.</p>
          </div>
        </div>
      ) : activeTab === "financials" ? (
        <div className="space-y-3">
        <ReportPeriodPicker value={bookingPeriod} onChange={setBookingPeriod} label="Group transactions by" />
        {groupReportRows(filtered, bookingPeriod, activeTimezone, b => b.created_at).map(group => {
          const totals = financialTotals(group.rows);
          return <ReportPeriodGroup key={`${bookingPeriod}:${group.key}`} label={group.label} summary={`${group.rows.length} transactions · Net ${fmtCurrency(totals.net)}`}>
            <div className="space-y-3 md:hidden">
              {group.rows.map(b => {
                const received = amountReceived(b);
                const refunded = amountRefunded(b);
                const method = derivePaymentMethod(b);
                return (
                  <div key={b.id} className="border-t p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name || "—"}</p>
                        <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{fmtDateTime(b.created_at, activeTimezone)}</p>
                        <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--ck-text-muted)" }}>{b.id.substring(0, 8).toUpperCase()}{method ? ` · ${method}` : ""}</p>
                      </div>
                      <span className={statusPill(b.status)}>{b.status}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg p-2" style={{ background: "var(--ck-surface-sunken)" }}>
                        <p className="ui-mono-label !text-[9.5px]">Received</p>
                        <p className="mt-0.5 font-semibold tabular-nums" style={{ color: "var(--ck-success)" }}>{fmtCurrency(received)}</p>
                      </div>
                      <div className="rounded-lg p-2" style={{ background: "var(--ck-surface-sunken)" }}>
                        <p className="ui-mono-label !text-[9.5px]">Net</p>
                        <p className="mt-0.5 font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{fmtCurrency(received - refunded)}</p>
                      </div>
                    </div>
                    {refunded > 0 && <p className="mt-2 text-xs" style={{ color: "var(--ck-danger)" }}>Refunded {fmtCurrency(refunded)}</p>}
                  </div>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto border-t md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Transaction Date</Th>
                    <Th>Booking Ref</Th>
                    <Th>Customer</Th>
                    <Th>Method</Th>
                    <Th className="text-right">Total Due</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">Refunded</Th>
                    <Th className="text-right">Net</Th>
                    <Th className="text-center">Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                  {group.rows.map(b => {
                    const due = Number(b.total_amount || 0);
                    const received = amountReceived(b);
                    const refunded = amountRefunded(b);
                    const method = derivePaymentMethod(b);
                    return (
                      <tr key={b.id} className="transition-colors hover:bg-[var(--ck-surface-sunken)]">
                        <td className="whitespace-nowrap p-3 font-medium" style={{ color: "var(--ck-text)" }}>{fmtDateTime(b.created_at, activeTimezone)}</td>
                        <td className="p-3 font-mono text-xs" style={{ color: "var(--ck-text-muted)" }} title={b.yoco_payment_id || b.payfast_m_payment_id || ""}>{b.id.substring(0, 8).toUpperCase()}</td>
                        <td className="min-w-[150px] p-3" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name || "—"}</td>
                        <td className="p-3 text-xs" style={{ color: method === "Unrecorded" ? "var(--ck-warning)" : "var(--ck-text-muted)" }}>{method || "—"}</td>
                        <td className="p-3 text-right tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{fmtCurrency(due)}</td>
                        <td className="p-3 text-right tabular-nums" style={{ color: received > 0 ? "var(--ck-success)" : "var(--ck-text-muted)" }}>{received > 0 ? fmtCurrency(received) : "—"}</td>
                        <td className="p-3 text-right tabular-nums" style={{ color: refunded > 0 ? "var(--ck-danger)" : "var(--ck-text-muted)" }}>{refunded > 0 ? "-" + fmtCurrency(refunded) : "—"}</td>
                        <td className="p-3 text-right font-bold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{fmtCurrency(received - refunded)}</td>
                        <td className="p-3 text-center"><span className={statusPill(b.status)}>{b.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 text-sm font-semibold" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface-warm)" }}>
                    <td colSpan={4} className="p-3 text-right" style={{ color: "var(--ck-text-muted)" }}>Group total</td>
                    <td className="p-3 text-right tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{fmtCurrency(totals.grossBooked)}</td>
                    <td className="p-3 text-right tabular-nums" style={{ color: "var(--ck-success)" }}>{fmtCurrency(totals.received)}</td>
                    <td className="p-3 text-right tabular-nums" style={{ color: totals.refunded > 0 ? "var(--ck-danger)" : "var(--ck-text-muted)" }}>{totals.refunded > 0 ? "-" + fmtCurrency(totals.refunded) : "—"}</td>
                    <td className="p-3 text-right font-bold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{fmtCurrency(totals.net)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </ReportPeriodGroup>;
        })}
        </div>
      ) : activeTab === "attendance" ? (
        (() => {
          const activeBookings = filtered.filter(b => b.status !== "CANCELLED");
          const totalPax = activeBookings.reduce((s, b) => s + Number(b.qty || 0), 0);
          const checkedInPax = activeBookings.reduce((s, b) => s + arrivedGuests(b), 0);
          const noShowPax = totalPax - checkedInPax;
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Total Pax", value: totalPax, color: "var(--ck-text-strong)" },
                  { label: "Checked In", value: checkedInPax, color: "var(--ck-success)" },
                  { label: "Not Arrived", value: noShowPax, color: "var(--ck-danger)" },
                  { label: "Attendance Rate", value: `${totalPax > 0 ? Math.round((checkedInPax / totalPax) * 100) : 0}%`, color: "var(--ck-text-strong)" },
                ].map(c => (
                  <div key={c.label} className="ui-card p-4">
                    <p className="ui-mono-label !text-[10px]">{c.label}</p>
                    <p className="font-display mt-1.5 text-[26px] font-semibold leading-none tabular-nums" style={{ color: c.color }}>{c.value}</p>
                  </div>
                ))}
              </div>
              <ReportPeriodPicker value={bookingPeriod} onChange={setBookingPeriod} label="Group attendance by" />
              {groupReportRows(activeBookings, bookingPeriod, activeTimezone, b => b.slots?.start_time).map(group => {
                const totalPax = group.rows.reduce((sum, b) => sum + Number(b.qty || 0), 0);
                const checkedInPax = group.rows.reduce((sum, b) => sum + arrivedGuests(b), 0);
                return <ReportPeriodGroup key={`${bookingPeriod}:${group.key}`} label={group.label} summary={`${group.rows.length} bookings · ${checkedInPax} of ${totalPax} arrived`}>
              <div className="space-y-3 md:hidden">
                {group.rows.map(b => (
                  <div key={b.id} className="border-t p-4" style={b.checked_in ? { borderColor: "var(--ck-success)", background: "var(--ck-success-soft)" } : arrivedGuests(b) > 0 ? { borderColor: "var(--ck-amber)", background: "var(--ck-amber-soft)" } : undefined}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name || "—"}</p>
                        <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.tours?.name || "—"} · {b.slots?.start_time ? `${fmtDate(b.slots.start_time, activeTimezone)} ${fmtTime(b.slots.start_time, activeTimezone)}` : "—"}</p>
                        <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.phone || "No phone"}</p>
                      </div>
                      <span className={`ui-status ${b.checked_in ? "ui-pill-success" : arrivedGuests(b) > 0 ? "ui-pill-amber" : "ui-pill-danger"}`}>
                        {attendanceLabel(b)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-sm" style={{ background: "var(--ck-surface-sunken)" }}>
                      <span style={{ color: "var(--ck-text-muted)" }}>Pax</span>
                      <span className="font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{b.qty}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto border-t md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <Th>Tour Date</Th>
                      <Th>Time</Th>
                      <Th>Tour</Th>
                      <Th>Customer</Th>
                      <Th className="hidden md:table-cell">Phone</Th>
                      <Th className="text-right">Pax</Th>
                      <Th className="text-center">Checked In</Th>
                      <Th className="hidden lg:table-cell">Check-in Time</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                    {group.rows.map(b => (
                      <tr key={b.id} className="transition-colors hover:bg-[var(--ck-surface-sunken)]" style={b.checked_in ? { background: "var(--ck-success-soft)" } : arrivedGuests(b) > 0 ? { background: "var(--ck-amber-soft)" } : undefined}>
                        <td className="whitespace-nowrap p-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "—"}</td>
                        <td className="whitespace-nowrap p-3 tabular-nums" style={{ color: "var(--ck-text)" }}>{b.slots?.start_time ? fmtTime(b.slots.start_time, activeTimezone) : "—"}</td>
                        <td className="p-3" style={{ color: "var(--ck-text)" }}>{b.tours?.name || "—"}</td>
                        <td className="p-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name || "—"}</td>
                        <td className="hidden p-3 text-xs md:table-cell" style={{ color: "var(--ck-text-muted)" }}>{b.phone || "—"}</td>
                        <td className="p-3 text-right font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{b.qty}</td>
                        <td className="p-3 text-center">
                          <span className={`ui-status ${b.checked_in ? "ui-pill-success" : arrivedGuests(b) > 0 ? "ui-pill-amber" : "ui-pill-danger"}`}>
                            {attendanceLabel(b)}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap p-3 text-xs lg:table-cell" style={{ color: "var(--ck-text-muted)" }}>
                          {b.checked_in_at ? fmtDateTime(b.checked_in_at, activeTimezone) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 text-sm font-semibold" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface-warm)" }}>
                      <td colSpan={5} className="p-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>Totals ({group.rows.length} bookings)</td>
                      <td className="p-3 text-right tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{totalPax}</td>
                      <td className="p-3 text-center" style={{ color: "var(--ck-success)" }}>{checkedInPax} present</td>
                      <td className="hidden p-3 lg:table-cell"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
                </ReportPeriodGroup>;
              })}
            </div>
          );
        })()
      ) : activeTab === "marketing" ? (
        <>
        <div className="space-y-3 md:hidden">
          {Object.values(filtered.reduce((acc: any, b: any) => {
            const src = b.source || "UNKNOWN";
            if (!acc[src]) acc[src] = { source: src, count: 0, pax: 0, revenue: 0 };
            acc[src].count++;
            acc[src].pax += b.qty;
            if (["PAID", "COMPLETED", "CONFIRMED"].includes(b.status)) {
              acc[src].revenue += Number(b.total_amount || 0);
            }
            return acc;
          }, {})).map((d: any) => (
            <div key={d.source} className="ui-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>{d.source}</p>
                <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--ck-success)" }}>{fmtCurrency(d.revenue)}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg p-2" style={{ background: "var(--ck-surface-sunken)" }}>
                  <p className="ui-mono-label !text-[9.5px]">Bookings</p>
                  <p className="mt-0.5 font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{d.count}</p>
                </div>
                <div className="rounded-lg p-2" style={{ background: "var(--ck-surface-sunken)" }}>
                  <p className="ui-mono-label !text-[9.5px]">Pax</p>
                  <p className="mt-0.5 font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{d.pax}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="ui-card hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Source Name</Th>
                <Th className="text-right">Bookings</Th>
                <Th className="text-right">Total Pax</Th>
                <Th className="text-right">Revenue</Th>
                <Th className="text-right">Avg Order Value</Th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
              {Object.values(filtered.reduce((acc: any, b: any) => {
                const src = b.source || "UNKNOWN";
                if (!acc[src]) acc[src] = { source: src, count: 0, pax: 0, revenue: 0 };
                acc[src].count++;
                acc[src].pax += b.qty;
                if (["PAID", "COMPLETED", "CONFIRMED"].includes(b.status)) {
                  acc[src].revenue += Number(b.total_amount || 0);
                }
                return acc;
              }, {})).map((d: any) => (
                <tr key={d.source} className="transition-colors hover:bg-[var(--ck-surface-sunken)]">
                  <td className="p-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{d.source}</td>
                  <td className="p-3 text-right tabular-nums" style={{ color: "var(--ck-text)" }}>{d.count}</td>
                  <td className="p-3 text-right tabular-nums" style={{ color: "var(--ck-text)" }}>{d.pax} pax</td>
                  <td className="p-3 text-right font-bold tabular-nums" style={{ color: "var(--ck-success)" }}>{fmtCurrency(d.revenue)}</td>
                  <td className="p-3 text-right tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{fmtCurrency(d.count > 0 ? d.revenue / d.count : 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 text-sm font-semibold" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface-warm)" }}>
                <td className="p-3" style={{ color: "var(--ck-text-muted)" }}>Totals</td>
                <td className="p-3 text-right tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{summary.total}</td>
                <td className="p-3 text-right tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{summary.pax} pax</td>
                <td className="p-3 text-right font-bold tabular-nums" style={{ color: "var(--ck-success)" }}>{fmtCurrency(summary.revenue)}</td>
                <td className="p-3 text-right tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{fmtCurrency(summary.total > 0 ? summary.revenue / summary.total : 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      ) : activeTab === "waivers" ? (
        (() => {
          const active = filtered.filter(b => b.status !== "CANCELLED");
          const signed = active.filter(b => b.waiver_status === "SIGNED");
          const pending = active.filter(b => b.waiver_status !== "SIGNED");
          return (
            <div className="space-y-4">
              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {active.map(b => (
                  <div key={b.id} className="ui-card p-4" style={b.waiver_status === "SIGNED" ? { borderColor: "var(--ck-success)", background: "var(--ck-success-soft)" } : { borderColor: "var(--ck-amber)", background: "var(--ck-amber-soft)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name || "—"}</p>
                        <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.tours?.name || "—"} · {b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "—"}</p>
                        <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.phone || "No phone"}</p>
                      </div>
                      <span className={`ui-status shrink-0 ${b.waiver_status === "SIGNED" ? "ui-pill-success" : "ui-pill-warning"}`}>
                        {b.waiver_status === "SIGNED" ? "✓ Signed" : "Pending"}
                      </span>
                    </div>
                    {b.waiver_status === "SIGNED" && (
                      <p className="mt-2 text-xs" style={{ color: "var(--ck-success)" }}>Signed by {b.waiver_signed_name || "guest"} · {b.waiver_signed_at ? fmtDateTime(b.waiver_signed_at, activeTimezone) : "—"}</p>
                    )}
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="ui-card hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <Th>Ref</Th>
                      <Th>Tour Date</Th>
                      <Th>Customer</Th>
                      <Th>Tour</Th>
                      <Th className="text-center">Pax</Th>
                      <Th className="text-center">Waiver</Th>
                      <Th>Signed By</Th>
                      <Th>Signed At</Th>
                      <Th className="text-center">Booking</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                    {active.map(b => (
                      <tr key={b.id} className="transition-colors hover:bg-[var(--ck-surface-sunken)]" style={b.waiver_status === "SIGNED" ? undefined : { background: "var(--ck-amber-soft)" }}>
                        <td className="p-3 font-mono text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.id.substring(0, 8).toUpperCase()}</td>
                        <td className="whitespace-nowrap p-3" style={{ color: "var(--ck-text)" }}>{b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "—"}</td>
                        <td className="p-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name || "—"}</td>
                        <td className="p-3" style={{ color: "var(--ck-text)" }}>{b.tours?.name || "—"}</td>
                        <td className="p-3 text-center tabular-nums" style={{ color: "var(--ck-text)" }}>{b.qty}</td>
                        <td className="p-3 text-center">
                          <span className={`ui-status ${b.waiver_status === "SIGNED" ? "ui-pill-success" : "ui-pill-warning"}`}>
                            {b.waiver_status === "SIGNED" ? "✓ Signed" : "Pending"}
                          </span>
                        </td>
                        <td className="p-3" style={{ color: "var(--ck-text)" }}>{b.waiver_signed_name || "—"}</td>
                        <td className="whitespace-nowrap p-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.waiver_signed_at ? fmtDateTime(b.waiver_signed_at, activeTimezone) : "—"}</td>
                        <td className="p-3 text-center"><span className={statusPill(b.status)}>{b.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 text-sm font-semibold" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface-warm)" }}>
                      <td colSpan={5} className="p-3 text-right" style={{ color: "var(--ck-text-muted)" }}>{signed.length} signed / {pending.length} pending</td>
                      <td colSpan={4} className="p-3 text-center" style={{ color: "var(--ck-success)" }}>
                        {active.length > 0 ? Math.round((signed.length / active.length) * 100) : 0}% compliance
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })()
      ) : (
        <section className="ui-card overflow-hidden" aria-label="Bookings by period">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <h2 className="text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>Bookings by {bookingPeriod}</h2>
            <ReportPeriodPicker value={bookingPeriod} onChange={setBookingPeriod} label="Group bookings by" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Period</Th><Th className="text-right">Bookings</Th><Th className="text-right">Guests</Th></tr></thead>
              <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                {bookingPeriods.map(group => <tr key={group.key}>
                  <td className="p-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{group.label}</td>
                  <td className="p-3 text-right tabular-nums">{group.bookings}</td>
                  <td className="p-3 text-right tabular-nums">{group.guests}</td>
                </tr>)}
              </tbody>
              <tfoot><tr className="border-t-2 font-semibold" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface-warm)" }}>
                <td className="p-3">Total</td><td className="p-3 text-right tabular-nums">{summary.total}</td><td className="p-3 text-right tabular-nums">{summary.pax}</td>
              </tr></tfoot>
            </table>
          </div>
        </section>
      )}
    </ReportsLayout>
  );
}
