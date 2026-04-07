"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { DatePicker } from "../../components/DatePicker";
import { useBusinessContext } from "../../components/BusinessContext";

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

const STATUS_COLORS: Record<string, string> = {
  PAID: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  CONFIRMED: "bg-blue-100 text-blue-700",
  PENDING: "bg-amber-100 text-amber-700",
  HELD: "bg-orange-100 text-orange-700",
  CANCELLED: "bg-gray-200 text-gray-600",
};

export default function Reports() {
  const { businessId, timezone } = useBusinessContext();
  const activeTimezone = timezone || "UTC";
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(() => monthStartStr(activeTimezone));
  const [endDate, setEndDate] = useState(() => todayStr(activeTimezone));
  const [filterBy, setFilterBy] = useState<"slot" | "created">("slot");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [sortCol, setSortCol] = useState<"created_at" | "slot_time" | "total_amount">("slot_time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [activeTab, setActiveTab] = useState<"bookings" | "financials" | "marketing" | "attendance" | "waivers">("bookings");

  useEffect(() => {
    setStartDate(monthStartStr(activeTimezone));
    setEndDate(todayStr(activeTimezone));
  }, [activeTimezone]);

  async function loadReport() {
    setLoading(true);
    const startIso = startDate + "T00:00:00+02:00";
    const endIso = endDate + "T23:59:59+02:00";

    let slotIds: string[] | null = null;
    if (filterBy === "slot") {
      // Two-step: first get slot IDs in the date range, then query bookings
      const { data: slotRows } = await supabase
        .from("slots")
        .select("id")
        .eq("business_id", businessId)
        .gte("start_time", startIso)
        .lte("start_time", endIso);
      slotIds = (slotRows || []).map((s: any) => s.id);
      if (slotIds.length === 0) {
        setBookings([]);
        setLoading(false);
        return;
      }
    }

    let query = supabase
      .from("bookings")
      .select("id, customer_name, phone, email, qty, unit_price, total_amount, original_total, discount_type, discount_percent, status, yoco_payment_id, source, created_at, checked_in, checked_in_at, waiver_status, waiver_signed_at, waiver_signed_name, tours(name), slots(start_time)")
      .eq("business_id", businessId);

    if (filterBy === "slot" && slotIds) {
      query = query.in("slot_id", slotIds);
    } else {
      query = query.gte("created_at", startIso).lte("created_at", endIso);
    }

    const { data, error } = await query.order("created_at", { ascending: false }).limit(2000);
    if (error) console.error("Report load error:", error);
    setBookings((data || []).map((b: any) => ({
      ...b,
      tours: Array.isArray(b.tours) ? b.tours[0] || null : b.tours,
      slots: Array.isArray(b.slots) ? b.slots[0] || null : b.slots,
    })));
    setLoading(false);
  }

  useEffect(() => { loadReport(); }, [startDate, endDate, filterBy, businessId]);

  const filtered = useMemo(() => {
    let rows = filterStatus === "ALL" ? bookings : bookings.filter(b => b.status === filterStatus);
    rows = [...rows].sort((a, b) => {
      let av: any, bv: any;
      if (sortCol === "slot_time") {
        av = a.slots?.start_time || a.created_at;
        bv = b.slots?.start_time || b.created_at;
      } else if (sortCol === "total_amount") {
        av = Number(a.total_amount || 0);
        bv = Number(b.total_amount || 0);
      } else {
        av = a.created_at;
        bv = b.created_at;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [bookings, filterStatus, sortCol, sortDir]);

  const summary = useMemo(() => {
    const paid = filtered.filter(b => ["PAID", "COMPLETED", "CONFIRMED"].includes(b.status));
    const active = filtered.filter(b => b.status !== "CANCELLED");
    return {
      total: filtered.length,
      pax: filtered.reduce((s, b) => s + Number(b.qty || 0), 0),
      revenue: paid.reduce((s, b) => s + Number(b.total_amount || 0), 0),
      pending: filtered.filter(b => b.status === "PENDING").length,
      cancelled: filtered.filter(b => b.status === "CANCELLED").length,
      waiverSigned: active.filter(b => b.waiver_status === "SIGNED").length,
      waiverPending: active.filter(b => b.waiver_status !== "SIGNED").length,
    };
  }, [filtered]);

  const visualSeries = useMemo(() => {
    if (activeTab === "marketing") {
      const grouped = Object.values(
        filtered.reduce((acc: Record<string, { label: string; value: number }>, booking) => {
          const source = booking.source || "UNKNOWN";
          if (!acc[source]) acc[source] = { label: source, value: 0 };
          acc[source].value += 1;
          return acc;
        }, {})
      );
      return grouped.sort((a, b) => b.value - a.value).slice(0, 5);
    }

    if (activeTab === "attendance") {
      return [
        { label: "Checked in", value: filtered.filter((booking) => booking.checked_in).reduce((sum, booking) => sum + Number(booking.qty || 0), 0) },
        { label: "Not checked in", value: filtered.filter((booking) => !booking.checked_in && booking.status !== "CANCELLED").reduce((sum, booking) => sum + Number(booking.qty || 0), 0) },
      ];
    }

    if (activeTab === "waivers") {
      const active = filtered.filter(b => b.status !== "CANCELLED");
      return [
        { label: "Signed", value: active.filter(b => b.waiver_status === "SIGNED").length },
        { label: "Pending", value: active.filter(b => b.waiver_status !== "SIGNED").length },
      ];
    }

    if (activeTab === "financials") {
      const grouped = Object.values(
        filtered.reduce((acc: Record<string, { label: string; value: number }>, booking) => {
          const status = booking.status || "UNKNOWN";
          if (!acc[status]) acc[status] = { label: status, value: 0 };
          acc[status].value += Number(booking.total_amount || 0);
          return acc;
        }, {})
      );
      return grouped.sort((a, b) => b.value - a.value).slice(0, 5);
    }

    const grouped = Object.values(
      filtered.reduce((acc: Record<string, { label: string; value: number }>, booking) => {
        const tour = booking.tours?.name || "Unknown";
        if (!acc[tour]) acc[tour] = { label: tour, value: 0 };
        acc[tour].value += Number(booking.qty || 0);
        return acc;
      }, {})
    );
    return grouped.sort((a, b) => b.value - a.value).slice(0, 5);
  }, [activeTab, filtered]);

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  function sortIcon(col: typeof sortCol) {
    if (sortCol !== col) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="text-blue-600 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  function downloadCSV() {
    if (activeTab === "attendance") {
      const activeBookings = filtered.filter(b => b.status !== "CANCELLED");
      const headers = ["Tour Date", "Time", "Tour", "Customer", "Phone", "Pax", "Checked In", "Checked In At", "Status"];
      const rows = activeBookings.map(b => [
        b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "",
        b.slots?.start_time ? fmtTime(b.slots.start_time, activeTimezone) : "",
        b.tours?.name || "",
        b.customer_name || "",
        b.phone || "",
        b.qty || 0,
        b.checked_in ? "Yes" : "No",
        b.checked_in_at ? fmtDateTime(b.checked_in_at, activeTimezone) : "",
        b.status || ""
      ]);
      const csv = [headers, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-${startDate}-to-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (activeTab === "financials") {
      const headers = ["Transaction Date", "Booking Ref", "Gateway Ref", "Customer Name", "Subtotal", "Discount", "Total Amount", "Status"];
      const rows = filtered.map(b => [
        fmtDateTime(b.created_at, activeTimezone),
        b.id.substring(0, 8).toUpperCase(),
        b.yoco_payment_id || "",
        b.customer_name || "",
        Number(b.original_total || b.total_amount || 0).toFixed(2),
        Number((b.original_total || b.total_amount || 0) - (b.total_amount || 0)).toFixed(2),
        Number(b.total_amount || 0).toFixed(2),
        b.status || ""
      ]);
      const csv = [headers, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `financials-${startDate}-to-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (activeTab === "marketing") {
      const marketingData = Object.values(
        filtered.reduce((acc: any, b: any) => {
          const src = b.source || "UNKNOWN";
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
      const csv = [headers, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `marketing-${startDate}-to-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
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
      const csv = [headers, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `waivers-${startDate}-to-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const headers = [
      "Ref", "Booked At", "Customer Name", "Phone", "Email",
      "Tour", "Slot Date", "Slot Time",
      "Qty", "Unit Price", "Original Total", "Discount Type", "Discount %",
      "Total Amount", "Status", "Source", "Payment Ref", "Waiver",
    ];
    const rows = filtered.map(b => [
      b.id.substring(0, 8).toUpperCase(),
      fmtDateTime(b.created_at, activeTimezone),
      b.customer_name || "",
      b.phone || "",
      b.email || "",
      b.tours?.name || "",
      b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "",
      b.slots?.start_time ? fmtTime(b.slots.start_time, activeTimezone) : "",
      b.qty || 0,
      Number(b.unit_price || 0).toFixed(2),
      Number(b.original_total || b.total_amount || 0).toFixed(2),
      b.discount_type || "",
      b.discount_percent || 0,
      Number(b.total_amount || 0).toFixed(2),
      b.status || "",
      b.source || "",
      b.yoco_payment_id || "",
      b.waiver_status === "SIGNED" ? "SIGNED" : "PENDING",
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bookings-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadPDF() {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF("landscape");
    doc.setFontSize(14);

    let title = "";
    let headers: string[] = [];
    let rows: any[][] = [];

    if (activeTab === "attendance") {
      const activeBookings = filtered.filter(b => b.status !== "CANCELLED");
      title = `Attendance Report (${startDate} to ${endDate})`;
      headers = ["Date", "Time", "Tour", "Customer", "Pax", "Checked In", "Status"];
      rows = activeBookings.map(b => [
        b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "—",
        b.slots?.start_time ? fmtTime(b.slots.start_time, activeTimezone) : "—",
        b.tours?.name || "—",
        b.customer_name || "—",
        b.qty,
        b.checked_in ? "Yes" : "No",
        b.status
      ]);
    } else if (activeTab === "financials") {
      title = `Financial Report (${startDate} to ${endDate})`;
      headers = ["Date", "Booking Ref", "Gateway Ref", "Customer", "Subtotal", "Discount", "Net Paid", "Status"];
      rows = filtered.map(b => [
        fmtDateTime(b.created_at, activeTimezone),
        b.id.substring(0, 8).toUpperCase(),
        b.yoco_payment_id || "—",
        b.customer_name || "—",
        fmtCurrency(Number(b.original_total || b.total_amount || 0)),
        fmtCurrency(Number((b.original_total || b.total_amount || 0) - (b.total_amount || 0))),
        fmtCurrency(Number(b.total_amount || 0)),
        b.status
      ]);
    } else if (activeTab === "marketing") {
      title = `Marketing Report (${startDate} to ${endDate})`;
      headers = ["Source", "Bookings", "Total Pax", "Revenue", "Avg. Order Value"];

      const marketingData = Object.values(
        filtered.reduce((acc: any, b: any) => {
          const src = b.source || "UNKNOWN";
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
      title = `Bookings Report (${startDate} to ${endDate})`;
      headers = ["Ref", "Date", "Customer", "Tour", "Date/Time", "Qty", "Total", "Status", "Waiver"];
      rows = filtered.map(b => [
        b.id.substring(0, 8).toUpperCase(),
        fmtDate(b.created_at, activeTimezone),
        b.customer_name || "—",
        b.tours?.name || "—",
        b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "—",
        b.qty,
        fmtCurrency(Number(b.total_amount || 0)),
        b.status,
        b.waiver_status === "SIGNED" ? "Signed" : "Pending",
      ]);
    }

    doc.text(title, 14, 15);

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: 20,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [4, 120, 87] }, // Emerald-600
    });

    doc.save(`${activeTab}-${startDate}-to-${endDate}.pdf`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Reports</h2>
          <p className="text-sm text-gray-500">All bookings — filter by tour date or booking date, download as CSV or PDF.</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <button
            onClick={downloadCSV}
            disabled={filtered.length === 0}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            CSV ({filtered.length})
          </button>
          <button
            onClick={downloadPDF}
            disabled={filtered.length === 0}
            className="rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
          >
            PDF
          </button>
        </div>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max border-b border-gray-200">
          <button
            onClick={() => setActiveTab("bookings")}
            className={`px-4 py-2 text-sm font-medium ${activeTab === "bookings" ? "border-b-2 border-emerald-600 text-emerald-600" : "text-gray-500 hover:text-gray-700"}`}
          >
            Bookings
          </button>
          <button
            onClick={() => setActiveTab("financials")}
            className={`px-4 py-2 text-sm font-medium ${activeTab === "financials" ? "border-b-2 border-emerald-600 text-emerald-600" : "text-gray-500 hover:text-gray-700"}`}
          >
            Financials
          </button>
          <button
            onClick={() => setActiveTab("marketing")}
            className={`px-4 py-2 text-sm font-medium ${activeTab === "marketing" ? "border-b-2 border-emerald-600 text-emerald-600" : "text-gray-500 hover:text-gray-700"}`}
          >
            Marketing
          </button>
          <button
            onClick={() => setActiveTab("attendance")}
            className={`px-4 py-2 text-sm font-medium ${activeTab === "attendance" ? "border-b-2 border-emerald-600 text-emerald-600" : "text-gray-500 hover:text-gray-700"}`}
          >
            Attendance
          </button>
          <button
            onClick={() => setActiveTab("waivers")}
            className={`px-4 py-2 text-sm font-medium ${activeTab === "waivers" ? "border-b-2 border-emerald-600 text-emerald-600" : "text-gray-500 hover:text-gray-700"}`}
          >
            Waivers
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="text-sm text-gray-600 sm:min-w-[150px]">
          Filter by
          <select value={filterBy} onChange={e => setFilterBy(e.target.value as "slot" | "created")}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
            <option value="slot">Tour date</option>
            <option value="created">Booking date</option>
          </select>
        </label>
        <label className="text-sm text-gray-600 flex flex-col gap-1 sm:min-w-[150px]">
          From
          <DatePicker value={startDate} onChange={setStartDate} />
        </label>
        <label className="text-sm text-gray-600 flex flex-col gap-1 sm:min-w-[150px]">
          To
          <DatePicker alignRight={true} value={endDate} onChange={setEndDate} />
        </label>
        <label className="text-sm text-gray-600 sm:min-w-[160px]">
          Status
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
            <option value="ALL">All Statuses</option>
            <option value="PAID">PAID</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="CONFIRMED">CONFIRMED</option>
            <option value="PENDING">PENDING</option>
            <option value="HELD">HELD</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </label>
        <button onClick={loadReport} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50 sm:py-1.5">
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      {activeTab === "waivers" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Active Bookings", value: summary.total - summary.cancelled },
            { label: "Waivers Signed", value: summary.waiverSigned, color: "text-emerald-600" },
            { label: "Waivers Pending", value: summary.waiverPending, color: summary.waiverPending > 0 ? "text-amber-600" : "text-gray-800" },
            { label: "Compliance", value: (summary.waiverSigned + summary.waiverPending) > 0 ? Math.round((summary.waiverSigned / (summary.waiverSigned + summary.waiverPending)) * 100) + "%" : "—" },
          ].map(c => (
            <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 text-center">
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className={`text-xl font-bold ${c.color || "text-gray-800"}`}>{c.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Bookings", value: summary.total },
            { label: "Pax", value: summary.pax },
            { label: "Revenue", value: fmtCurrency(summary.revenue) },
            { label: "Pending", value: summary.pending },
            { label: "Cancelled", value: summary.cancelled },
          ].map(c => (
            <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 text-center">
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className="text-xl font-bold text-gray-800">{c.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-800">Visual breakdown</h3>
            <span className="text-xs text-gray-500">
              {activeTab === "financials" ? "Revenue by status" : activeTab === "marketing" ? "Bookings by source" : activeTab === "attendance" ? "Attendance by pax" : activeTab === "waivers" ? "Signed vs pending" : "Pax by activity"}
            </span>
          </div>
          {visualSeries.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              No chart data available for this filter.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {visualSeries.map((item) => {
                const max = Math.max(...visualSeries.map((entry) => entry.value), 1);
                const width = Math.max((item.value / max) * 100, 8);
                return (
                  <div key={item.label}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-gray-700">{item.label}</span>
                      <span className="font-semibold text-gray-900">{activeTab === "financials" ? fmtCurrency(item.value) : item.value}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-gray-100">
                      <div className="h-2.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-800">Date range context</h3>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">From</p>
              <p className="mt-2 font-semibold text-gray-900">{startDate || "Not set"}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">To</p>
              <p className="mt-2 font-semibold text-gray-900">{endDate || "Not set"}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Filtered by</p>
              <p className="mt-2 font-semibold text-gray-900">{filterBy === "slot" ? "Tour date" : "Booking date"}</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status scope</p>
              <p className="mt-2 font-semibold text-gray-900">{filterStatus}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-gray-200 bg-white">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          No records found for this period.
        </div>
      ) : activeTab === "financials" ? (
        <>
        <div className="space-y-3 md:hidden">
          {filtered.map(b => {
            const sub = Number(b.original_total || b.total_amount || 0);
            const tot = Number(b.total_amount || 0);
            const disc = sub - tot;
            return (
              <div key={b.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{b.customer_name || "—"}</p>
                    <p className="text-xs text-gray-500">{fmtDateTime(b.created_at, activeTimezone)}</p>
                    <p className="mt-1 font-mono text-[11px] text-gray-400">{b.id.substring(0, 8).toUpperCase()}</p>
                  </div>
                  <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[b.status] || "bg-gray-100 text-gray-600"}`}>
                    {b.status}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-[11px] text-gray-500">Subtotal</p>
                    <p className="font-semibold">{fmtCurrency(sub)}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-[11px] text-gray-500">Net Paid</p>
                    <p className="font-semibold text-emerald-700">{fmtCurrency(tot)}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-amber-600">{disc > 0 ? `Discount ${fmtCurrency(disc)}` : "No discount"}</p>
              </div>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600">
                <th className="p-3">Transaction Date</th>
                <th className="p-3">Booking Ref</th>
                <th className="p-3">Gateway Ref</th>
                <th className="p-3">Customer</th>
                <th className="p-3 text-right">Subtotal</th>
                <th className="p-3 text-right text-amber-600">Discounts</th>
                <th className="p-3 text-right text-emerald-700">Net Paid</th>
                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(b => {
                const sub = Number(b.original_total || b.total_amount || 0);
                const tot = Number(b.total_amount || 0);
                const disc = sub - tot;
                return (
                  <tr key={b.id} className="hover:bg-gray-50/60">
                    <td className="p-3 font-medium text-gray-700 whitespace-nowrap">{fmtDateTime(b.created_at, activeTimezone)}</td>
                    <td className="p-3 font-mono text-xs text-gray-500">{b.id.substring(0, 8).toUpperCase()}</td>
                    <td className="p-3 font-mono text-xs text-gray-400">{b.yoco_payment_id || "—"}</td>
                    <td className="p-3 min-w-[150px]">{b.customer_name || "—"}</td>
                    <td className="p-3 text-right text-gray-500">{fmtCurrency(sub)}</td>
                    <td className="p-3 text-right text-amber-600">{disc > 0 ? "-" + fmtCurrency(disc) : "—"}</td>
                    <td className="p-3 text-right font-bold text-emerald-700">{fmtCurrency(tot)}</td>
                    <td className="p-3 text-center">
                      <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[b.status] || "bg-gray-100 text-gray-600"}`}>
                        {b.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-sm">
                <td colSpan={6} className="p-3 text-right text-gray-500">Total Net Revenue</td>
                <td className="p-3 text-right text-emerald-700 font-bold">{fmtCurrency(summary.revenue)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      ) : activeTab === "attendance" ? (
        (() => {
          const activeBookings = filtered.filter(b => b.status !== "CANCELLED");
          const totalPax = activeBookings.reduce((s, b) => s + Number(b.qty || 0), 0);
          const checkedInPax = activeBookings.filter(b => b.checked_in).reduce((s, b) => s + Number(b.qty || 0), 0);
          const noShowPax = totalPax - checkedInPax;
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
                  <p className="text-xs text-gray-500">Total Pax</p>
                  <p className="text-xl font-bold text-gray-800">{totalPax}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
                  <p className="text-xs text-gray-500">Checked In</p>
                  <p className="text-xl font-bold text-emerald-700">{checkedInPax}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
                  <p className="text-xs text-gray-500">No Show</p>
                  <p className="text-xl font-bold text-red-600">{noShowPax}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
                  <p className="text-xs text-gray-500">Attendance Rate</p>
                  <p className="text-xl font-bold text-gray-800">{totalPax > 0 ? Math.round((checkedInPax / totalPax) * 100) : 0}%</p>
                </div>
              </div>
              <div className="space-y-3 md:hidden">
                {activeBookings.map(b => (
                  <div key={b.id} className={`rounded-xl border border-gray-200 bg-white p-4 ${b.checked_in ? "border-emerald-200 bg-emerald-50/30" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{b.customer_name || "—"}</p>
                        <p className="text-xs text-gray-500">{b.tours?.name || "—"} · {b.slots?.start_time ? `${fmtDate(b.slots.start_time, activeTimezone)} ${fmtTime(b.slots.start_time, activeTimezone)}` : "—"}</p>
                        <p className="mt-1 text-xs text-gray-400">{b.phone || "No phone"}</p>
                      </div>
                      <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${b.checked_in ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                        {b.checked_in ? "Present" : "No Show"}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                      <span className="text-gray-500">Pax</span>
                      <span className="font-semibold">{b.qty}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600">
                      <th className="p-3">Tour Date</th>
                      <th className="p-3">Time</th>
                      <th className="p-3">Tour</th>
                      <th className="p-3">Customer</th>
                      <th className="hidden p-3 md:table-cell">Phone</th>
                      <th className="p-3 text-right">Pax</th>
                      <th className="p-3 text-center">Checked In</th>
                      <th className="hidden p-3 lg:table-cell">Check-in Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {activeBookings.map(b => (
                      <tr key={b.id} className={`hover:bg-gray-50/60 ${b.checked_in ? "bg-emerald-50/40" : ""}`}>
                        <td className="p-3 whitespace-nowrap font-medium">{b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "—"}</td>
                        <td className="p-3 whitespace-nowrap">{b.slots?.start_time ? fmtTime(b.slots.start_time, activeTimezone) : "—"}</td>
                        <td className="p-3 text-gray-600">{b.tours?.name || "—"}</td>
                        <td className="p-3 font-medium">{b.customer_name || "—"}</td>
                        <td className="hidden p-3 md:table-cell text-xs text-gray-500">{b.phone || "—"}</td>
                        <td className="p-3 text-right font-semibold">{b.qty}</td>
                        <td className="p-3 text-center">
                          <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${b.checked_in ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                            {b.checked_in ? "Present" : "No Show"}
                          </span>
                        </td>
                        <td className="hidden p-3 lg:table-cell text-xs text-gray-400 whitespace-nowrap">
                          {b.checked_in_at ? fmtDateTime(b.checked_in_at, activeTimezone) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-sm">
                      <td colSpan={5} className="p-3 text-gray-500 text-xs">Totals ({activeBookings.length} bookings)</td>
                      <td className="p-3 text-right">{totalPax}</td>
                      <td className="p-3 text-center text-emerald-700">{checkedInPax} present</td>
                      <td className="hidden p-3 lg:table-cell"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
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
            <div key={d.source} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-gray-800">{d.source}</p>
                <p className="text-sm font-semibold text-emerald-700">{fmtCurrency(d.revenue)}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-gray-50 p-2">
                  <p className="text-[11px] text-gray-500">Bookings</p>
                  <p className="font-semibold">{d.count}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-2">
                  <p className="text-[11px] text-gray-500">Pax</p>
                  <p className="font-semibold">{d.pax}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600">
                <th className="p-3">Source Name</th>
                <th className="p-3 text-right">Bookings</th>
                <th className="p-3 text-right">Total Pax</th>
                <th className="p-3 text-right">Revenue</th>
                <th className="p-3 text-right">Avg Order Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
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
                <tr key={d.source} className="hover:bg-gray-50/60">
                  <td className="p-3 font-medium text-gray-700">{d.source}</td>
                  <td className="p-3 text-right">{d.count}</td>
                  <td className="p-3 text-right">{d.pax} pax</td>
                  <td className="p-3 text-right font-bold text-emerald-700">{fmtCurrency(d.revenue)}</td>
                  <td className="p-3 text-right text-gray-500">{fmtCurrency(d.count > 0 ? d.revenue / d.count : 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-sm">
                <td className="p-3 text-gray-500">Totals</td>
                <td className="p-3 text-right">{summary.total}</td>
                <td className="p-3 text-right">{summary.pax} pax</td>
                <td className="p-3 text-right text-emerald-700 font-bold">{fmtCurrency(summary.revenue)}</td>
                <td className="p-3 text-right text-gray-500">{fmtCurrency(summary.total > 0 ? summary.revenue / summary.total : 0)}</td>
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
                  <div key={b.id} className={`rounded-xl border bg-white p-4 ${b.waiver_status === "SIGNED" ? "border-emerald-200 bg-emerald-50/30" : "border-amber-200 bg-amber-50/20"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{b.customer_name || "—"}</p>
                        <p className="text-xs text-gray-500">{b.tours?.name || "—"} · {b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "—"}</p>
                        <p className="mt-1 text-xs text-gray-400">{b.phone || "No phone"}</p>
                      </div>
                      <span className={`inline-block shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${b.waiver_status === "SIGNED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {b.waiver_status === "SIGNED" ? "✓ Signed" : "Pending"}
                      </span>
                    </div>
                    {b.waiver_status === "SIGNED" && (
                      <p className="mt-2 text-xs text-emerald-600">Signed by {b.waiver_signed_name || "guest"} · {b.waiver_signed_at ? fmtDateTime(b.waiver_signed_at, activeTimezone) : "—"}</p>
                    )}
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600">
                      <th className="p-3">Ref</th>
                      <th className="p-3">Tour Date</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3">Tour</th>
                      <th className="p-3 text-center">Pax</th>
                      <th className="p-3 text-center">Waiver</th>
                      <th className="p-3">Signed By</th>
                      <th className="p-3">Signed At</th>
                      <th className="p-3 text-center">Booking</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {active.map(b => (
                      <tr key={b.id} className={`hover:bg-gray-50/60 ${b.waiver_status === "SIGNED" ? "" : "bg-amber-50/20"}`}>
                        <td className="p-3 font-mono text-xs text-gray-400">{b.id.substring(0, 8).toUpperCase()}</td>
                        <td className="p-3 text-gray-700 whitespace-nowrap">{b.slots?.start_time ? fmtDate(b.slots.start_time, activeTimezone) : "—"}</td>
                        <td className="p-3 font-medium text-gray-800">{b.customer_name || "—"}</td>
                        <td className="p-3 text-gray-600">{b.tours?.name || "—"}</td>
                        <td className="p-3 text-center text-gray-700">{b.qty}</td>
                        <td className="p-3 text-center">
                          <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${b.waiver_status === "SIGNED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                            {b.waiver_status === "SIGNED" ? "✓ Signed" : "Pending"}
                          </span>
                        </td>
                        <td className="p-3 text-gray-600">{b.waiver_signed_name || "—"}</td>
                        <td className="p-3 text-gray-500 whitespace-nowrap text-xs">{b.waiver_signed_at ? fmtDateTime(b.waiver_signed_at, activeTimezone) : "—"}</td>
                        <td className="p-3 text-center">
                          <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[b.status] || "bg-gray-100 text-gray-600"}`}>{b.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50 text-sm font-semibold">
                      <td colSpan={5} className="p-3 text-right text-gray-500">{signed.length} signed / {pending.length} pending</td>
                      <td colSpan={4} className="p-3 text-center text-emerald-700">
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
        <>
        <div className="space-y-3 md:hidden">
          {filtered.map(b => {
            const hasDiscount = b.discount_type && b.discount_type !== "none";
            return (
              <div key={b.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{b.customer_name || "—"}</p>
                    <p className="text-xs text-gray-500">{b.slots?.start_time ? `${fmtDate(b.slots.start_time, activeTimezone)} · ${fmtTime(b.slots.start_time, activeTimezone)}` : "—"}</p>
                    <p className="mt-1 text-xs text-gray-400">{b.tours?.name || "—"}</p>
                    <p className="mt-1 text-xs text-gray-400">{b.phone || "No phone"}{b.email ? ` · ${b.email}` : ""}</p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[b.status] || "bg-gray-100 text-gray-600"}`}>
                    {b.status}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-[11px] text-gray-500">Qty</p>
                    <p className="font-semibold">{b.qty}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-[11px] text-gray-500">Total</p>
                    <p className="font-semibold text-emerald-700">{fmtCurrency(Number(b.total_amount || 0))}</p>
                  </div>
                </div>
                {hasDiscount && (
                  <p className="mt-2 text-xs text-amber-600">
                    {b.discount_type === "PERCENT" ? `${b.discount_percent}% off` :
                      b.discount_type === "FIXED" ? "Fixed discount" :
                        b.discount_type === "MANUAL" ? "Manual price" : b.discount_type}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600">
                <th className="hidden p-3 md:table-cell">Ref</th>
                <th className="p-3 cursor-pointer hover:text-blue-600" onClick={() => toggleSort("slot_time")}>
                  Tour Date {sortIcon("slot_time")}
                </th>
                <th className="p-3">Customer</th>
                <th className="hidden p-3 md:table-cell">Contact</th>
                <th className="hidden p-3 lg:table-cell">Tour</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 cursor-pointer text-right hover:text-blue-600" onClick={() => toggleSort("total_amount")}>
                  Total {sortIcon("total_amount")}
                </th>
                <th className="hidden p-3 lg:table-cell">Discount</th>
                <th className="p-3">Status</th>
                <th className="hidden p-3 xl:table-cell cursor-pointer hover:text-blue-600" onClick={() => toggleSort("created_at")}>
                  Booked {sortIcon("created_at")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(b => {
                const hasDiscount = b.discount_type && b.discount_type !== "none";
                return (
                  <tr key={b.id} className="hover:bg-gray-50/60">
                    <td className="hidden p-3 font-mono text-xs text-gray-500 md:table-cell">{b.id.substring(0, 8).toUpperCase()}</td>
                    <td className="p-3 whitespace-nowrap">
                      {b.slots?.start_time ? (
                        <span>
                          <span className="font-medium">{fmtDate(b.slots.start_time, activeTimezone)}</span>
                          <span className="ml-1 text-gray-400 text-xs">{fmtTime(b.slots.start_time, activeTimezone)}</span>
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="p-3">
                      <p className="font-medium">{b.customer_name || "—"}</p>
                    </td>
                    <td className="hidden p-3 md:table-cell">
                      <p className="text-xs text-gray-500">{b.phone || "—"}</p>
                      <p className="text-xs text-gray-400">{b.email || "—"}</p>
                    </td>
                    <td className="hidden p-3 lg:table-cell text-gray-600">{b.tours?.name || "—"}</td>
                    <td className="p-3 text-right">{b.qty}</td>
                    <td className="p-3 text-right">
                      {hasDiscount && b.original_total ? (
                        <div>
                          <p className="line-through text-xs text-gray-400">{fmtCurrency(Number(b.original_total))}</p>
                          <p className="font-semibold text-emerald-700">{fmtCurrency(Number(b.total_amount || 0))}</p>
                        </div>
                      ) : (
                        <p className="font-semibold">{fmtCurrency(Number(b.total_amount || 0))}</p>
                      )}
                    </td>
                    <td className="hidden p-3 lg:table-cell text-xs text-gray-500">
                      {hasDiscount ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 font-medium">
                          {b.discount_type === "PERCENT" ? `${b.discount_percent}% off` :
                            b.discount_type === "FIXED" ? "Fixed" :
                              b.discount_type === "MANUAL" ? "Manual" : b.discount_type}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="p-3">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[b.status] || "bg-gray-100 text-gray-600"}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="hidden p-3 xl:table-cell text-xs text-gray-400 whitespace-nowrap">
                      {fmtDateTime(b.created_at, activeTimezone)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-sm">
                <td className="hidden md:table-cell p-3"></td>
                <td className="p-3 text-gray-500 text-xs">Totals ({filtered.length})</td>
                <td className="p-3"></td>
                <td className="hidden p-3 md:table-cell"></td>
                <td className="hidden p-3 lg:table-cell"></td>
                <td className="p-3 text-right">{summary.pax}</td>
                <td className="p-3 text-right text-emerald-700">{fmtCurrency(summary.revenue)}</td>
                <td className="hidden p-3 lg:table-cell"></td>
                <td className="p-3"></td>
                <td className="hidden p-3 xl:table-cell"></td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
