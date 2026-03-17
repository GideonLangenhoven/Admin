"use client";
import { useEffect, useMemo, useState } from "react";
import { notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import { DatePicker } from "../../components/DatePicker";

type AnyRecord = Record<string, unknown>;

interface InvoiceRecord extends AnyRecord {
  id: string;
  invoice_number?: string | null;
  booking_id?: string | null;
  booking_number?: string | null;
  booking_reference?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  tour_name?: string | null;
  tour_date?: string | null;
  qty?: number | null;
  adults_qty?: number | null;
  children_qty?: number | null;
  guides_qty?: number | null;
  total_amount?: number | null;
  amount_paid?: number | null;
  paid_amount?: number | null;
  payment_method?: string | null;
  notes?: string | null;
  created_at?: string | null;
  booking_created_at?: string | null;
}

interface BookingDateRow {
  id: string;
  created_at: string | null;
}

interface InvoiceDayGroup {
  dayKey: string;
  dayLabel: string;
  invoices: InvoiceRecord[];
  total: number;
  paid: number;
  due: number;
}

const VAT_RATE = 0.15;
const FROM_COMPANY = {
  name: "Adventure Operator",
  addressLines: ["179 Beach Road Three Anchor Bay", "Cape Town", "8005"],
  reg: "Reg. 1995/051404/23",
  vat: "4290176926",
};

const BANKING_DETAILS = {
  owner: "Adventure Operator",
  number: "070631824",
  type: "Current / Cheque",
  bank: "Standard Bank",
  branchCode: "020909",
};

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asText(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length ? text : fallback;
}

function money(n: number) {
  return n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: unknown) {
  if (!iso) return "-";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: getAdminTimezone(),
  });
}

function escapeHtml(raw: string) {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function invoiceNumber(inv: InvoiceRecord) {
  const fallback = inv.id ? inv.id.slice(0, 8).toUpperCase() : "00000000";
  return asText(inv.invoice_number, fallback);
}

function bookingRef(inv: InvoiceRecord) {
  return asText(inv.booking_number || inv.booking_reference || inv.booking_id, inv.id.slice(0, 8).toUpperCase());
}

function counts(inv: InvoiceRecord) {
  const adults = asNumber(inv.adults_qty, asNumber(inv.qty, 0));
  const children = asNumber(inv.children_qty, 0);
  const guides = asNumber(inv.guides_qty, 0);
  return { adults, children, guides };
}

function payment(inv: InvoiceRecord) {
  const total = asNumber(inv.total_amount, 0);
  const amountPaid = asNumber(inv.amount_paid, asNumber(inv.paid_amount, 0));
  const balanceDue = Math.max(total - amountPaid, 0);
  const subtotal = total / (1 + VAT_RATE);
  const vat = total - subtotal;
  return { total, amountPaid, balanceDue, subtotal, vat };
}

function serviceDescription(inv: InvoiceRecord) {
  const tour = asText(inv.tour_name, "Kayak booking");
  const date = formatDate(inv.tour_date || inv.created_at);
  return `${tour} (${date})`;
}

function bookingDateValue(inv: InvoiceRecord) {
  const raw = inv.booking_created_at || inv.tour_date || inv.created_at;
  if (!raw) return 0;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function invoiceDateRaw(inv: InvoiceRecord) {
  return inv.booking_created_at || inv.tour_date || inv.created_at || null;
}

function dayKeyFromRaw(raw: unknown) {
  if (!raw) return "";
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: getAdminTimezone(),
  }).format(d);
}

function dayLabelFromRaw(raw: unknown) {
  if (!raw) return "Unknown Date";
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return "Unknown Date";
  return d.toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: getAdminTimezone(),
  });
}

function buildProFormaHtml(inv: InvoiceRecord) {
  const invNo = escapeHtml(invoiceNumber(inv));
  const ref = escapeHtml(bookingRef(inv));
  const toName = escapeHtml(asText(inv.customer_name, "Customer"));
  const toEmail = escapeHtml(asText(inv.customer_email, ""));
  const toPhone = escapeHtml(asText(inv.customer_phone, ""));
  const service = escapeHtml(serviceDescription(inv));
  const note = escapeHtml(asText(inv.notes, ""));
  const date = escapeHtml(formatDate(inv.created_at || inv.tour_date));
  const dueDate = escapeHtml(formatDate(inv.tour_date || inv.created_at));
  const { adults, children, guides } = counts(inv);
  const { total, amountPaid, balanceDue, subtotal, vat } = payment(inv);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pro Forma Invoice ${invNo}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    body { margin: 0; background: #eeeeee; font-family: Arial, Helvetica, sans-serif; color: #111; }
    .page { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 12mm; box-sizing: border-box; }
    .row { display: flex; justify-content: space-between; gap: 10mm; }
    .brand { font-size: 40px; line-height: 1; color: #28a2d4; margin-bottom: 2mm; }
    .title { font-size: 18px; font-weight: 800; letter-spacing: 0.03em; color: #898989; }
    .company { font-size: 18px; font-weight: 700; margin-top: 1mm; }
    .muted { font-size: 12px; color: #333; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #222; padding: 6px 7px; vertical-align: top; font-size: 12px; }
    th { background: #d8d8d8; text-align: left; font-weight: 700; }
    .num { text-align: right; font-family: "Courier New", monospace; }
    .summary td { font-size: 12px; }
    .summary-label { text-align: right; font-weight: 700; background: #efefef; }
    .summary-strong { font-weight: 800; background: #d3d3d3; }
    .section-title { font-size: 30px; letter-spacing: 0.06em; color: #898989; font-weight: 800; margin: 0 0 4mm; text-align: right; }
    .spacer { height: 6mm; }
    .hr { border: 0; border-top: 1px solid #cfcfcf; margin: 6mm 0; }
    .bank-title { font-size: 30px; font-weight: 700; margin-top: 8mm; margin-bottom: 3mm; }
    .bank td { border: none; padding: 2px 2px; font-size: 12px; }
    .bank .label { font-weight: 700; width: 38mm; }
    .to-line { white-space: pre-line; }
    @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="row">
      <div>
        <div class="brand">~</div>
        <div class="company">${escapeHtml(FROM_COMPANY.name)}</div>
        <div class="muted" style="margin-top:4mm;">${escapeHtml(FROM_COMPANY.reg)} VAT: ${escapeHtml(FROM_COMPANY.vat)}</div>
      </div>
      <div style="flex:1;">
        <h1 class="section-title">PROFORMA INVOICE</h1>
      </div>
    </div>

    <div class="spacer"></div>
    <div class="row">
      <table style="width: 56%;">
        <tr>
          <th style="width:50%;">From:</th>
          <th>To:</th>
        </tr>
        <tr>
          <td class="to-line">${escapeHtml(FROM_COMPANY.name)}\n${escapeHtml(FROM_COMPANY.addressLines.join("\n"))}</td>
          <td class="to-line">${toName}${toEmail ? `\n${toEmail}` : ""}${toPhone ? `\n${toPhone}` : ""}</td>
        </tr>
      </table>

      <table style="width: 38%;">
        <tr><th style="width:45%;">Invoice #:</th><td class="num">${invNo}</td></tr>
        <tr><th>Booking #:</th><td class="num">${ref}</td></tr>
        <tr><th>Date:</th><td class="num">${date}</td></tr>
        <tr><th>Amount Due:</th><td class="num">R${money(balanceDue)}</td></tr>
      </table>
    </div>

    <hr class="hr" />
    <table>
      <tr>
        <th>Service</th>
        <th style="width:17mm;" class="num">Adults (Qty)</th>
        <th style="width:19mm;" class="num">Children (Qty)</th>
        <th style="width:17mm;" class="num">Guides (Qty)</th>
        <th style="width:30mm;" class="num">Total Cost (ZAR)</th>
      </tr>
      <tr>
        <td>${service}</td>
        <td class="num">${adults}</td>
        <td class="num">${children}</td>
        <td class="num">${guides}</td>
        <td class="num">${money(total)}</td>
      </tr>
      ${note ? `<tr><td colspan="5">Price Change Reason: ${note}</td></tr>` : ""}
    </table>

    <table class="summary">
      <tr>
        <td style="width:50%; border-right:none;"></td>
        <td class="summary-label" style="width:15%;">Sub-total</td>
        <td class="summary-label" style="width:20%;">(Excl VAT)</td>
        <td class="num" style="width:15%;">${money(subtotal)}</td>
      </tr>
      <tr>
        <td style="border-right:none;"></td>
        <td class="summary-label"></td>
        <td class="summary-label">VAT - ${(VAT_RATE * 100).toFixed(1)}%</td>
        <td class="num">${money(vat)}</td>
      </tr>
      <tr>
        <td style="border-right:none;"></td>
        <td class="summary-label"></td>
        <td class="summary-label">Total:</td>
        <td class="num"><strong>${money(total)}</strong></td>
      </tr>
      <tr>
        <td style="border-right:none;"></td>
        <td class="summary-label"></td>
        <td class="summary-label">Amount Paid:</td>
        <td class="num">${money(amountPaid)}</td>
      </tr>
      <tr>
        <td style="border-right:none;"></td>
        <td class="summary-strong"></td>
        <td class="summary-label summary-strong">Balance Due:</td>
        <td class="num summary-strong"><strong>R${money(balanceDue)}</strong></td>
      </tr>
    </table>

    <div class="bank-title">Banking Details</div>
    <table class="bank">
      <tr><td class="label">Account Owner:</td><td>${escapeHtml(BANKING_DETAILS.owner)}</td></tr>
      <tr><td class="label">Account Number:</td><td>${escapeHtml(BANKING_DETAILS.number)}</td></tr>
      <tr><td class="label">Account Type:</td><td>${escapeHtml(BANKING_DETAILS.type)}</td></tr>
      <tr><td class="label">Bank Name:</td><td>${escapeHtml(BANKING_DETAILS.bank)}</td></tr>
      <tr><td class="label">Branch Code:</td><td>${escapeHtml(BANKING_DETAILS.branchCode)}</td></tr>
      <tr><td class="label">Reference:</td><td>${invNo}</td></tr>
    </table>
  </div>
</body>
</html>`;
}

function downloadHtmlFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openPrintWindow(html: string) {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) return false;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 300);
  return true;
}

export default function Invoices() {
  const { businessId } = useBusinessContext();
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [openActions, setOpenActions] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"booking_desc" | "booking_asc" | "created_desc" | "created_asc">("booking_desc");
  const [exactDate, setExactDate] = useState("");

  async function load() {
    const { data } = await supabase.from("invoices")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(200);

    const baseInvoices = (data || []) as InvoiceRecord[];
    const bookingIds = [...new Set(baseInvoices.map((inv) => inv.booking_id).filter(Boolean))] as string[];
    let bookingDateMap = new Map<string, string | null>();

    if (bookingIds.length > 0) {
      const { data: bookingRows } = await supabase
        .from("bookings")
        .select("id, created_at")
        .in("id", bookingIds);
      bookingDateMap = new Map(
        ((bookingRows || []) as BookingDateRow[]).map((b) => [b.id, b.created_at])
      );
    }

    const enriched = baseInvoices.map((inv) => ({
      ...inv,
      booking_created_at: inv.booking_id ? bookingDateMap.get(inv.booking_id) || inv.booking_created_at || null : inv.booking_created_at || null,
    }));

    setInvoices(enriched);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const totalOutstanding = useMemo(
    () => invoices.reduce((sum, inv) => sum + payment(inv).balanceDue, 0),
    [invoices]
  );

  const sortedInvoices = useMemo(() => {
    const list = [...invoices];
    list.sort((a, b) => {
      if (sortBy === "booking_desc") return bookingDateValue(b) - bookingDateValue(a);
      if (sortBy === "booking_asc") return bookingDateValue(a) - bookingDateValue(b);
      const createdA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const createdB = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (sortBy === "created_desc") return createdB - createdA;
      return createdA - createdB;
    });
    return list;
  }, [invoices, sortBy]);

  const filteredInvoices = useMemo(() => {
    if (!exactDate) return sortedInvoices;
    return sortedInvoices.filter((inv) => dayKeyFromRaw(invoiceDateRaw(inv)) === exactDate);
  }, [sortedInvoices, exactDate]);

  const dayGroups = useMemo<InvoiceDayGroup[]>(() => {
    const map = new Map<string, InvoiceRecord[]>();
    for (const inv of filteredInvoices) {
      const key = dayKeyFromRaw(invoiceDateRaw(inv)) || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inv);
    }

    const groups: InvoiceDayGroup[] = [];
    for (const [dayKey, items] of map) {
      const total = items.reduce((sum, inv) => sum + payment(inv).total, 0);
      const paid = items.reduce((sum, inv) => sum + payment(inv).amountPaid, 0);
      const due = items.reduce((sum, inv) => sum + payment(inv).balanceDue, 0);
      groups.push({
        dayKey,
        dayLabel: dayLabelFromRaw(invoiceDateRaw(items[0])),
        invoices: items,
        total,
        paid,
        due,
      });
    }
    return groups;
  }, [filteredInvoices]);

  function handleDownload(inv: InvoiceRecord) {
    setBusyId(inv.id);
    try {
      const html = buildProFormaHtml(inv);
      downloadHtmlFile(`proforma-${invoiceNumber(inv)}.html`, html);
    } finally {
      setBusyId(null);
    }
  }

  function handlePrint(inv: InvoiceRecord) {
    setBusyId(inv.id);
    try {
      const html = buildProFormaHtml(inv);
      const opened = openPrintWindow(html);
      if (!opened) {
        downloadHtmlFile(`proforma-${invoiceNumber(inv)}.html`, html);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleResend(inv: InvoiceRecord) {
    setResendingId(inv.id);
    try {
      const email = asText(inv.customer_email, "");
      if (!email) {
        notify({ title: "Missing email", message: "No customer email found for this invoice.", tone: "warning" });
        setResendingId(null);
        return;
      }
      const invNo = invoiceNumber(inv);
      const { adults } = counts(inv);
      const pay = payment(inv);

      const res = await supabase.functions.invoke("send-email", {
        body: {
          type: "INVOICE",
          data: {
            business_id: businessId,
            email,
            customer_name: asText(inv.customer_name, "Customer"),
            customer_email: email,
            invoice_number: invNo,
            invoice_date: formatDate(inv.created_at || inv.tour_date),
            tour_name: asText(inv.tour_name, "Kayak Booking"),
            tour_date: formatDate(inv.tour_date || inv.created_at),
            qty: adults || asNumber(inv.qty, 1),
            unit_price: money(adults > 0 ? pay.total / adults : pay.total),
            subtotal: money(pay.subtotal),
            total_amount: money(pay.total),
            payment_method: asText(inv.payment_method, "Online"),
            payment_reference: invNo,
          },
        },
      });
      if (res.error) {
        notify({ title: "Invoice resend failed", message: res.error.message, tone: "error" });
      } else {
        notify({ title: "Invoice resent", message: "Invoice resent to " + email, tone: "success" });
      }
    } catch (err: unknown) {
      notify({ title: "Invoice resend failed", message: asText((err as Error)?.message, String(err)), tone: "error" });
    } finally {
      setResendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Pro Forma Invoices</h2>
        <p className="text-sm text-gray-500">Download or print the pro forma version sent after successful bookings.</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
        <span className="font-semibold">Outstanding total:</span>{" "}
        <span className="font-mono">R{money(totalOutstanding)}</span>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
        <span className="font-medium text-gray-700">Sort by:</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "booking_desc" | "booking_asc" | "created_desc" | "created_asc")}
          className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-auto"
        >
          <option value="booking_desc">Booking date (newest first)</option>
          <option value="booking_asc">Booking date (oldest first)</option>
          <option value="created_desc">Invoice created (newest first)</option>
          <option value="created_asc">Invoice created (oldest first)</option>
        </select>
        <span className="font-medium text-gray-700 sm:ml-3">Exact date:</span>
        <DatePicker value={exactDate} onChange={setExactDate} />
        {exactDate && (
          <button
            type="button"
            onClick={() => setExactDate("")}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50"
          >
            Clear Date
          </button>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-gray-500">Loading...</div>
      ) : dayGroups.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          No invoices for the selected date/filter.
        </div>
      ) : (
        <div className="space-y-6">
          {dayGroups.map((day) => (
            <div key={day.dayKey}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-gray-800">{day.dayLabel}</h3>
                <span className="text-xs text-gray-500">
                  {day.invoices.length} invoices · Total R{money(day.total)} · Due R{money(day.due)}
                </span>
              </div>

              <div className="space-y-3 md:hidden">
                {day.invoices.map((inv) => {
                  const pay = payment(inv);
                  const isBusy = busyId === inv.id || resendingId === inv.id;
                  return (
                    <div key={inv.id} className="rounded-xl border border-gray-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-bold text-blue-600">{invoiceNumber(inv)}</p>
                          <p className="mt-1 text-sm font-semibold text-gray-800">{asText(inv.customer_name, "-")}</p>
                          <p className="text-xs text-gray-500">{asText(inv.customer_email, "")}</p>
                          <p className="mt-1 text-xs text-gray-400">{asText(inv.tour_name, "-")}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-800">R{money(pay.total)}</p>
                          <p className={`text-xs font-medium ${pay.balanceDue > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                            Due R{money(pay.balanceDue)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-lg bg-gray-50 p-2">
                          <p className="text-[11px] text-gray-500">Paid</p>
                          <p className="font-semibold">R{money(pay.amountPaid)}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 p-2">
                          <p className="text-[11px] text-gray-500">Booking</p>
                          <p className="font-mono text-xs font-semibold">{bookingRef(inv)}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <button onClick={() => handleDownload(inv)} disabled={isBusy} className="rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">Download</button>
                        <button onClick={() => handlePrint(inv)} disabled={isBusy} className="rounded-lg bg-gray-900 px-2.5 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">Print</button>
                        <button onClick={() => handleResend(inv)} disabled={isBusy} className="rounded-lg bg-blue-600 px-2.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{resendingId === inv.id ? "Resending..." : "Resend"}</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-gray-600">Invoice #</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 lg:table-cell">Booking #</th>
                      <th className="p-3 text-left font-medium text-gray-600">Customer</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 lg:table-cell">Service</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 xl:table-cell">Booking Date</th>
                      <th className="p-3 text-left font-medium text-gray-600">Total</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 md:table-cell">Paid</th>
                      <th className="p-3 text-left font-medium text-gray-600">Due</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 xl:table-cell">Created</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 lg:table-cell">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.invoices.map((inv) => {
                      const pay = payment(inv);
                      const isBusy = busyId === inv.id || resendingId === inv.id;
                      return (
                        <tr key={inv.id} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="p-3 font-mono font-bold text-blue-600">
                            <button
                              type="button"
                              className="flex items-center gap-1 text-left lg:pointer-events-none"
                              onClick={() => setOpenActions(openActions === inv.id ? null : inv.id)}
                            >
                              <span className="inline-block w-3 text-gray-400 transition-transform lg:hidden" style={{ transform: openActions === inv.id ? "rotate(90deg)" : "none" }}>›</span>
                              <span>{invoiceNumber(inv)}</span>
                            </button>
                            {openActions === inv.id && (
                              <div className="mt-2 flex flex-wrap gap-2 lg:hidden">
                                <button onClick={() => handleDownload(inv)} disabled={isBusy} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">Download</button>
                                <button onClick={() => handlePrint(inv)} disabled={isBusy} className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">Print / PDF</button>
                                <button onClick={() => handleResend(inv)} disabled={isBusy} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{resendingId === inv.id ? "Resending..." : "Resend"}</button>
                              </div>
                            )}
                          </td>
                          <td className="hidden p-3 font-mono text-xs lg:table-cell">{bookingRef(inv)}</td>
                          <td className="p-3">{asText(inv.customer_name, "-")}<br /><span className="text-xs text-gray-400">{asText(inv.customer_email, "")}</span></td>
                          <td className="hidden p-3 lg:table-cell">{asText(inv.tour_name, "-")}</td>
                          <td className="hidden p-3 text-xs xl:table-cell">{formatDate(inv.booking_created_at || inv.tour_date)}</td>
                          <td className="p-3 font-medium">R{money(pay.total)}</td>
                          <td className="hidden p-3 md:table-cell">R{money(pay.amountPaid)}</td>
                          <td className={`p-3 font-semibold ${pay.balanceDue > 0 ? "text-amber-700" : "text-emerald-700"}`}>R{money(pay.balanceDue)}</td>
                          <td className="hidden p-3 text-xs xl:table-cell">{formatDate(inv.created_at)}</td>
                          <td className="hidden p-3 lg:table-cell">
                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => handleDownload(inv)} disabled={isBusy} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">Download</button>
                              <button onClick={() => handlePrint(inv)} disabled={isBusy} className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">Print / PDF</button>
                              <button onClick={() => handleResend(inv)} disabled={isBusy} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{resendingId === inv.id ? "Resending..." : "Resend"}</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-700">
                      <td className="p-3 text-xs text-gray-500">Totals:</td>
                      <td className="hidden p-3 lg:table-cell"></td>
                      <td className="p-3"></td>
                      <td className="hidden p-3 lg:table-cell"></td>
                      <td className="hidden p-3 xl:table-cell"></td>
                      <td className="p-3">R{money(day.total)}</td>
                      <td className="hidden p-3 md:table-cell">R{money(day.paid)}</td>
                      <td className={`p-3 ${day.due > 0 ? "text-amber-700" : "text-emerald-700"}`}>R{money(day.due)}</td>
                      <td className="hidden p-3 xl:table-cell"></td>
                      <td className="hidden p-3 lg:table-cell"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
