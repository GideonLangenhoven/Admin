"use client";
import { useEffect, useMemo, useState } from "react";
import { notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import { DatePicker } from "../../components/DatePicker";
import { Warning, CaretRight } from "@phosphor-icons/react";

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

interface CompanyInfo {
  name: string;
  addressLines: string[];
  reg: string;
  vat: string;
}

interface BankingInfo {
  owner: string;
  number: string;
  type: string;
  bank: string;
  branchCode: string;
}

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

function normalizeInvNo(raw: string) {
  // Older rows stored as "INV-46"; newer rows pad to "INV-00046" via the
  // next_invoice_number RPC. Display + email consistently in the padded form.
  const m = /^INV-?(\d+)$/i.exec(raw.trim());
  return m ? "INV-" + m[1].padStart(5, "0") : raw;
}

function invoiceNumber(inv: InvoiceRecord) {
  const fallback = inv.id ? inv.id.slice(0, 8).toUpperCase() : "00000000";
  return normalizeInvNo(asText(inv.invoice_number, fallback));
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
  // No amount_paid column exists — same rule as send-email's invoice render:
  // an invoice is fully paid unless its payment method is still "Pending".
  const paidUnlessPending = String(inv.payment_method || "").trim().toLowerCase() === "pending" ? 0 : total;
  const amountPaid = asNumber(inv.amount_paid, asNumber(inv.paid_amount, paidUnlessPending));
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

function buildProFormaHtml(inv: InvoiceRecord, fromCompany: CompanyInfo, bankingDetails: BankingInfo) {
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
        <div class="company">${escapeHtml(fromCompany.name)}</div>
        <div class="muted" style="margin-top:4mm;">${escapeHtml(fromCompany.reg)} VAT: ${escapeHtml(fromCompany.vat)}</div>
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
          <td class="to-line">${escapeHtml(fromCompany.name)}\n${escapeHtml(fromCompany.addressLines.join("\n"))}</td>
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
      <tr><td class="label">Account Owner:</td><td>${escapeHtml(bankingDetails.owner)}</td></tr>
      <tr><td class="label">Account Number:</td><td>${escapeHtml(bankingDetails.number)}</td></tr>
      <tr><td class="label">Account Type:</td><td>${escapeHtml(bankingDetails.type)}</td></tr>
      <tr><td class="label">Bank Name:</td><td>${escapeHtml(bankingDetails.bank)}</td></tr>
      <tr><td class="label">Branch Code:</td><td>${escapeHtml(bankingDetails.branchCode)}</td></tr>
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
  // Open the rendered HTML directly via a Blob URL. Earlier we used
  // window.open("","_blank","noopener,noreferrer") + document.write, but
  // modern browsers return null from window.open when "noopener" is set,
  // leaving the tab stuck on about:blank with a 0-byte body. The Blob URL
  // path lets the browser render and print natively, and works in popups
  // gated by stricter same-origin rules.
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, "_blank");
  if (!popup) {
    URL.revokeObjectURL(url);
    return false;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

export default function Invoices() {
  const { businessId } = useBusinessContext();
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [recentlySentId, setRecentlySentId] = useState<string | null>(null);
  const [openActions, setOpenActions] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"booking_desc" | "booking_asc" | "created_desc" | "created_asc">("booking_desc");
  const [exactDate, setExactDate] = useState("");
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo>({ name: "", addressLines: [], reg: "", vat: "" });
  const [bankInfo, setBankInfo] = useState<BankingInfo>({ owner: "", number: "", type: "", bank: "", branchCode: "" });

  async function load() {
    const [invoiceRes, bizRes, bankRes] = await Promise.all([
      supabase.from("invoices").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(200),
      supabase.from("businesses").select("business_name, invoice_company_name, invoice_address_line1, invoice_address_line2, invoice_address_line3, invoice_reg_number, invoice_vat_number").eq("id", businessId).maybeSingle(),
      supabase.functions.invoke("bank-details", { body: { action: "get", business_id: businessId } }),
    ]);

    if (bizRes.data) {
      const b = bizRes.data;
      const name = b.invoice_company_name || b.business_name || "";
      setCompanyInfo({
        name,
        addressLines: [b.invoice_address_line1, b.invoice_address_line2, b.invoice_address_line3].filter(Boolean) as string[],
        reg: b.invoice_reg_number || "",
        vat: b.invoice_vat_number || "",
      });
    }
    if (bankRes.data) {
      setBankInfo({
        owner: bankRes.data.account_owner || "",
        number: bankRes.data.account_number || "",
        type: bankRes.data.account_type || "",
        bank: bankRes.data.bank_name || "",
        branchCode: bankRes.data.branch_code || "",
      });
    }

    const baseInvoices = (invoiceRes.data || []) as InvoiceRecord[];
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
      const html = buildProFormaHtml(inv, companyInfo, bankInfo);
      downloadHtmlFile(`proforma-${invoiceNumber(inv)}.html`, html);
    } finally {
      setBusyId(null);
    }
  }

  function handlePrint(inv: InvoiceRecord) {
    setBusyId(inv.id);
    try {
      const html = buildProFormaHtml(inv, companyInfo, bankInfo);
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
        notify({ title: "Invoice resend failed", message: res.error.message, tone: "error", duration: 6000 });
      } else {
        notify({ title: "Invoice resent", message: "Tax invoice " + invNo + " sent to " + email, tone: "success", duration: 5000 });
        setRecentlySentId(inv.id);
        setTimeout(() => setRecentlySentId((cur) => (cur === inv.id ? null : cur)), 3500);
      }
    } catch (err: unknown) {
      notify({ title: "Invoice resend failed", message: asText((err as Error)?.message, String(err)), tone: "error", duration: 6000 });
    } finally {
      setResendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="anim-fade-up">
        <p className="ui-mono-label mb-2">Billing</p>
        <h2 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Pro Forma Invoices</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>Download or print the pro forma version sent after successful bookings.</p>
      </div>

      {!loading && !companyInfo.name && (
        <div className="anim-fade-up flex items-start gap-2 rounded-xl border p-3 text-sm" style={{ background: "var(--ck-amber-soft)", borderColor: "color-mix(in srgb, var(--ck-amber) 25%, transparent)", color: "var(--ck-amber)" }}>
          <span className="mt-0.5 shrink-0"><Warning size={16} weight="fill" /></span>
          <span>Invoice company details not configured. Go to <strong>Settings &rarr; Invoice &amp; Banking Details</strong> to set your company name, address, and banking info.</span>
        </div>
      )}

      <div className="anim-fade-up anim-d1 ui-card ui-card-hover flex items-center gap-3 p-4">
        <div>
          <p className="ui-mono-label !text-[10px]">Outstanding total</p>
          <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{money(totalOutstanding)}</p>
        </div>
      </div>

      <div className="anim-fade-up anim-d2 ui-card flex flex-col gap-3 p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
        <span className="font-medium" style={{ color: "var(--ck-text)" }}>Sort by:</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "booking_desc" | "booking_asc" | "created_desc" | "created_asc")}
          className="ui-control w-full sm:w-auto"
        >
          <option value="booking_desc">Booking date (newest first)</option>
          <option value="booking_asc">Booking date (oldest first)</option>
          <option value="created_desc">Invoice created (newest first)</option>
          <option value="created_asc">Invoice created (oldest first)</option>
        </select>
        <span className="font-medium sm:ml-3" style={{ color: "var(--ck-text)" }}>Exact date:</span>
        <DatePicker value={exactDate} onChange={setExactDate} />
        {exactDate && (
          <button
            type="button"
            onClick={() => setExactDate("")}
            className="ui-btn ui-btn-ghost !h-8 !px-3 text-xs"
          >
            Clear Date
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="ui-skeleton h-8 w-56" />
          <div className="ui-skeleton h-[220px] !rounded-2xl" />
          <div className="ui-skeleton h-[220px] !rounded-2xl" />
        </div>
      ) : dayGroups.length === 0 ? (
        <div className="ui-card">
          <div className="ui-empty">
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No invoices found</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Nothing matches the selected date or filter.</p>
          </div>
        </div>
      ) : (
        <div className="anim-fade-up anim-d3 space-y-6">
          {dayGroups.map((day) => (
            <div key={day.dayKey}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>{day.dayLabel}</h3>
                <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--ck-text-muted)" }}>
                  {day.invoices.length} invoices · Total R{money(day.total)} · Due R{money(day.due)}
                </span>
              </div>

              <div className="space-y-3 md:hidden">
                {day.invoices.map((inv) => {
                  const pay = payment(inv);
                  const isBusy = busyId === inv.id || resendingId === inv.id;
                  return (
                    <div key={inv.id} className="ui-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-bold" style={{ color: "var(--ck-accent)" }}>{invoiceNumber(inv)}</p>
                          <p className="mt-1 text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{asText(inv.customer_name, "-")}</p>
                          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{asText(inv.customer_email, "")}</p>
                          <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>{asText(inv.tour_name, "-")}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{money(pay.total)}</p>
                          <p className="text-xs font-medium tabular-nums" style={{ color: pay.balanceDue > 0 ? "var(--ck-amber)" : "var(--ck-success)" }}>
                            Due R{money(pay.balanceDue)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-lg p-2" style={{ background: "var(--ck-surface-sunken)" }}>
                          <p className="ui-mono-label !text-[10px]">Paid</p>
                          <p className="font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{money(pay.amountPaid)}</p>
                        </div>
                        <div className="rounded-lg p-2" style={{ background: "var(--ck-surface-sunken)" }}>
                          <p className="ui-mono-label !text-[10px]">Booking</p>
                          <p className="font-mono text-xs font-semibold" style={{ color: "var(--ck-text-strong)" }}>{bookingRef(inv)}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <button onClick={() => handleDownload(inv)} disabled={isBusy} className="ui-btn ui-btn-ghost !h-auto !px-1.5 py-2 text-[11px] gap-1 disabled:opacity-50">Download</button>
                        <button onClick={() => handlePrint(inv)} disabled={isBusy} className="ui-btn ui-btn-ghost !h-auto !px-1.5 py-2 text-[11px] gap-1 disabled:opacity-50">Print</button>
                        <button onClick={() => handleResend(inv)} disabled={isBusy} className="ui-btn ui-btn-primary !h-auto !px-1.5 py-2 text-[11px] gap-1 disabled:opacity-50">{resendingId === inv.id ? "Resending…" : recentlySentId === inv.id ? "Sent" : "Resend"}</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="ui-card hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead style={{ background: "var(--ck-surface-sunken)" }}>
                    <tr>
                      <th className="p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-text-muted)" }}>Invoice #</th>
                      <th className="hidden p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] lg:table-cell" style={{ color: "var(--ck-text-muted)" }}>Booking #</th>
                      <th className="p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-text-muted)" }}>Customer</th>
                      <th className="hidden p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] lg:table-cell" style={{ color: "var(--ck-text-muted)" }}>Service</th>
                      <th className="hidden p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] xl:table-cell" style={{ color: "var(--ck-text-muted)" }}>Booking Date</th>
                      <th className="p-3 text-right text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-text-muted)" }}>Total</th>
                      <th className="hidden p-3 text-right text-[10.5px] font-medium uppercase tracking-[0.1em] md:table-cell" style={{ color: "var(--ck-text-muted)" }}>Paid</th>
                      <th className="p-3 text-right text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-text-muted)" }}>Due</th>
                      <th className="hidden p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] xl:table-cell" style={{ color: "var(--ck-text-muted)" }}>Created</th>
                      <th className="hidden p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] lg:table-cell" style={{ color: "var(--ck-text-muted)" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.invoices.map((inv) => {
                      const pay = payment(inv);
                      const isBusy = busyId === inv.id || resendingId === inv.id;
                      return (
                        <tr key={inv.id} className="border-t transition-colors hover:bg-[var(--ck-surface-sunken)]" style={{ borderColor: "var(--ck-border-subtle)" }}>
                          <td className="p-3 font-mono font-bold" style={{ color: "var(--ck-accent)" }}>
                            <button
                              type="button"
                              className="flex items-center gap-1 text-left lg:pointer-events-none"
                              onClick={() => setOpenActions(openActions === inv.id ? null : inv.id)}
                            >
                              <span className="inline-block transition-transform lg:hidden" style={{ transform: openActions === inv.id ? "rotate(90deg)" : "none", color: "var(--ck-text-muted)" }}><CaretRight size={12} weight="bold" /></span>
                              <span>{invoiceNumber(inv)}</span>
                            </button>
                            {openActions === inv.id && (
                              <div className="mt-2 flex flex-wrap gap-2 lg:hidden">
                                <button onClick={() => handleDownload(inv)} disabled={isBusy} className="ui-btn ui-btn-ghost !h-8 !px-2.5 text-xs gap-1.5 disabled:opacity-50">Download</button>
                                <button onClick={() => handlePrint(inv)} disabled={isBusy} className="ui-btn ui-btn-ghost !h-8 !px-2.5 text-xs gap-1.5 disabled:opacity-50">Print / PDF</button>
                                <button onClick={() => handleResend(inv)} disabled={isBusy} className="ui-btn ui-btn-primary !h-8 !px-2.5 text-xs gap-1.5 disabled:opacity-50">{resendingId === inv.id ? "Resending…" : recentlySentId === inv.id ? "Sent" : "Resend"}</button>
                              </div>
                            )}
                          </td>
                          <td className="hidden p-3 font-mono text-xs lg:table-cell" style={{ color: "var(--ck-text-muted)" }}>{bookingRef(inv)}</td>
                          <td className="p-3" style={{ color: "var(--ck-text)" }}>{asText(inv.customer_name, "-")}<br /><span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{asText(inv.customer_email, "")}</span></td>
                          <td className="hidden p-3 lg:table-cell" style={{ color: "var(--ck-text)" }}>{asText(inv.tour_name, "-")}</td>
                          <td className="hidden p-3 text-xs xl:table-cell" style={{ color: "var(--ck-text-muted)" }}>{formatDate(inv.booking_created_at || inv.tour_date)}</td>
                          <td className="p-3 text-right font-medium tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{money(pay.total)}</td>
                          <td className="hidden p-3 text-right tabular-nums md:table-cell" style={{ color: "var(--ck-text)" }}>R{money(pay.amountPaid)}</td>
                          <td className="p-3 text-right font-semibold tabular-nums" style={{ color: pay.balanceDue > 0 ? "var(--ck-amber)" : "var(--ck-success)" }}>R{money(pay.balanceDue)}</td>
                          <td className="hidden p-3 text-xs xl:table-cell" style={{ color: "var(--ck-text-muted)" }}>{formatDate(inv.created_at)}</td>
                          <td className="hidden p-3 lg:table-cell">
                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => handleDownload(inv)} disabled={isBusy} className="ui-btn ui-btn-ghost !h-8 !px-2.5 text-xs gap-1.5 disabled:opacity-50">Download</button>
                              <button onClick={() => handlePrint(inv)} disabled={isBusy} className="ui-btn ui-btn-ghost !h-8 !px-2.5 text-xs gap-1.5 disabled:opacity-50">Print / PDF</button>
                              <button onClick={() => handleResend(inv)} disabled={isBusy} className="ui-btn ui-btn-primary !h-8 !px-2.5 text-xs gap-1.5 disabled:opacity-50">{resendingId === inv.id ? "Resending…" : recentlySentId === inv.id ? "Sent" : "Resend"}</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    <tr className="border-t-2 font-semibold" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface-sunken)", color: "var(--ck-text-strong)" }}>
                      <td className="p-3"><span className="ui-mono-label !text-[10px]">Totals</span></td>
                      <td className="hidden p-3 lg:table-cell"></td>
                      <td className="p-3"></td>
                      <td className="hidden p-3 lg:table-cell"></td>
                      <td className="hidden p-3 xl:table-cell"></td>
                      <td className="p-3 text-right tabular-nums">R{money(day.total)}</td>
                      <td className="hidden p-3 text-right tabular-nums md:table-cell">R{money(day.paid)}</td>
                      <td className="p-3 text-right tabular-nums" style={{ color: day.due > 0 ? "var(--ck-amber)" : "var(--ck-success)" }}>R{money(day.due)}</td>
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
