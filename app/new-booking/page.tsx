"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { confirmAction, notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { listAvailableSlots } from "../lib/slot-availability";
import AvailabilityCalendar from "../../components/AvailabilityCalendar";
import { useBusinessContext } from "../../components/BusinessContext";
import { CaretDown, Check, CalendarBlank } from "@phosphor-icons/react";
import * as Sentry from "@sentry/nextjs";

interface Tour {
  id: string;
  name: string;
  business_id: string | null;
  base_price_per_person: number | null;
  peak_price_per_person: number | null;
}

interface Slot {
  id: string;
  start_time: string;
  capacity_total: number;
  booked: number;
  held?: number;
  status: string;
  tour_id: string;
  price_per_person_override: number | null;
  available_capacity: number;
  tour_name?: string | null;
}

interface AvailabilityPreviewSlot {
  id: string;
  start_time: string;
  capacity_total: number;
  booked: number;
  tour_id: string;
  available_capacity: number;
}

interface AddOn {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
}

interface BookingCustomFieldDefinition {
  key: string;
  label: string;
  type?: "text" | "textarea" | "number";
  placeholder?: string;
  required?: boolean;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: getAdminTimezone(),
  });
}

function fmtCurrency(v: number) {
  return "R" + v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayInput() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: getAdminTimezone(),
  }).format(new Date());
}

function dateKey(iso: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: getAdminTimezone(),
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

function addDays(dateInput: string, days: number) {
  const date = new Date(`${dateInput}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function formatDayLabel(dateInput: string) {
  return new Date(`${dateInput}T12:00:00`).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    timeZone: getAdminTimezone(),
  });
}

function formatWeekdayLabel(dateInput: string) {
  return new Date(`${dateInput}T12:00:00`).toLocaleDateString("en-ZA", {
    weekday: "long",
    timeZone: getAdminTimezone(),
  });
}

function normalizePhone(phone: string): string {
  let clean = phone.replace(/[\s\-\+\(\)]/g, "");
  if (clean.startsWith("0")) {
    clean = "27" + clean.substring(1);
  }
  return clean;
}

function isValidSAPhone(phone: string): boolean {
  const clean = normalizePhone(phone);
  return clean.startsWith("27") && clean.length >= 11 && clean.length <= 12;
}

function dayRange(dateInput: string) {
  const start = new Date(`${dateInput}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

interface CustomDropdownProps {
  label?: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
  placeholder: string;
  error?: boolean;
}

function CustomSelect({ label, value, options, onChange, placeholder, error }: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`mt-1.5 flex h-12 w-full items-center justify-between rounded-xl border transition-all px-4 text-sm font-medium bg-[var(--ck-surface)] ${
          error
            ? "border-[var(--ck-danger)] ring-1 ring-[var(--ck-danger)]"
            : open
              ? "border-[var(--ck-accent)] ring-2 ring-[var(--ck-accent)]/15"
              : "border-[var(--ck-border-strong)] hover:border-[var(--ck-accent)]"
        } ${open ? "z-50" : "z-0"}`}
      >
        <span style={{ color: selected ? "var(--ck-text-strong)" : "var(--ck-text-muted)" }}>
          {selected ? selected.name : placeholder}
        </span>
        <CaretDown size={18} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} style={{ color: "var(--ck-text-muted)" }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="ui-card absolute left-0 right-0 top-full z-[70] mt-2 max-h-72 overflow-y-auto p-1.5 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
            {options.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm font-medium" style={{ color: "var(--ck-text-muted)" }}>No options available</div>
            ) : (
              options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onChange(opt.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-left text-sm transition-all duration-200 ${
                    value === opt.id
                      ? "bg-[var(--ck-accent-soft)] text-[var(--ck-accent)] font-bold"
                      : "font-medium hover:bg-[var(--ck-surface-sunken)]"
                  }`}
                  style={value === opt.id ? undefined : { color: "var(--ck-text)" }}
                >
                  <span className="truncate">{opt.name}</span>
                  {value === opt.id && <Check size={16} className="shrink-0" />}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CustomNumberInput({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: boolean }) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold" style={{ color: "var(--ck-text)" }}>{label}</span>
      </div>
      <div className="relative mt-1.5">
        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            if (value === "0") onChange("");
          }}
          onBlur={(e) => {
            if (value === "") onChange("0");
          }}
          className={`h-12 w-full rounded-xl border px-4 text-base font-bold transition-all bg-[var(--ck-surface)] ${
            error
              ? "border-[var(--ck-danger)] ring-1 ring-[var(--ck-danger)]"
              : "border-[var(--ck-border-strong)] hover:border-[var(--ck-accent)] focus:border-[var(--ck-accent)] focus:ring-4 focus:ring-[var(--ck-accent)]/15"
          }`}
          style={{ color: "var(--ck-text-strong)" }}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-xs font-bold" style={{ color: "var(--ck-text-muted)" }}>
          Manual input
        </div>
      </div>
    </div>
  );
}

export default function NewBookingPage() {
  const router = useRouter();
  const { businessId } = useBusinessContext();
  const [tours, setTours] = useState<Tour[]>([]);
  const [loadingTours, setLoadingTours] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [availabilityPreviewSlots, setAvailabilityPreviewSlots] = useState<AvailabilityPreviewSlot[]>([]);
  const [loadingAvailabilityPreview, setLoadingAvailabilityPreview] = useState(false);
  const [selectedTourId, setSelectedTourId] = useState("");
  const [bookingDate, setBookingDate] = useState(todayInput());
  const [matrixStartDate, setMatrixStartDate] = useState(todayInput());
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [pendingMatrixSelection, setPendingMatrixSelection] = useState<{ day: string; slotId: string } | null>(null);
  const [adults, setAdults] = useState("0");
  const [children, setChildren] = useState("0");
  const [customerName, setCustomerName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [holdHours, setHoldHours] = useState("24");
  const [discountType, setDiscountType] = useState<"none" | "manual" | "promo">("none");
  const [discountValue, setDiscountValue] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoResult, setPromoResult] = useState<{ valid: boolean; error?: string; discount_type?: string; discount_value?: number; promo_id?: string; code?: string } | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");
  const [missingField, setMissingField] = useState<string | null>(null);
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<BookingCustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [availableAddOns, setAvailableAddOns] = useState<AddOn[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, number>>({});

  function formatSupabaseError(err: { message?: string; details?: string; hint?: string; code?: string } | null) {
    if (!err) return "Unknown error";
    const bits = [err.message, err.details, err.hint, err.code].filter(Boolean);
    return bits.join(" | ");
  }

  async function loadTours() {
    console.log("[NEW_BOOKING] loadTours started", { businessId });
    setLoadingTours(true);
    const { data } = await supabase
      .from("tours")
      .select("id, name, business_id, base_price_per_person, peak_price_per_person")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("sort_order", { ascending: true });
    const rows = (data || []) as Tour[];
    console.log("[NEW_BOOKING] loadTours complete", { tourCount: rows.length });
    setTours(rows);
    if (!selectedTourId && rows[0]?.id) setSelectedTourId(rows[0].id);
    setLoadingTours(false);
  }

  async function loadBusinessSettings() {
    if (!businessId) return;
    const { data } = await supabase
      .from("businesses")
      .select("booking_custom_fields")
      .eq("id", businessId)
      .maybeSingle();

    const defs = Array.isArray(data?.booking_custom_fields)
      ? (data?.booking_custom_fields as BookingCustomFieldDefinition[]).filter((field) => field?.key && field?.label)
      : [];
    setCustomFieldDefinitions(defs);
    setCustomFieldValues((current) => {
      const next: Record<string, string> = {};
      for (const field of defs) {
        next[field.key] = current[field.key] || "";
      }
      return next;
    });
  }

  async function loadSlots() {
    if (!bookingDate) return;
    console.log("[NEW_BOOKING] loadSlots started", { bookingDate, selectedTourId });
    setLoadingSlots(true);
    const { startIso, endIso } = dayRange(bookingDate);
    const nextSlots = await listAvailableSlots({
      businessId,
      startIso,
      endIso,
      tourId: selectedTourId || null,
    }) as Slot[];
    console.log("[NEW_BOOKING] loadSlots complete", { slotCount: nextSlots.length });
    setSlots(nextSlots);
    setSelectedSlotId((current) => {
      const desiredSlotId = pendingMatrixSelection?.day === bookingDate ? pendingMatrixSelection.slotId : current;
      if (desiredSlotId && nextSlots.some((slot) => slot.id === desiredSlotId)) return desiredSlotId;
      return current && nextSlots.some((slot) => slot.id === current) ? current : "";
    });
    if (pendingMatrixSelection?.day === bookingDate) {
      setPendingMatrixSelection(null);
    }
    setLoadingSlots(false);
  }

  async function loadAvailabilityPreview() {
    if (!matrixStartDate || !businessId || !selectedTourId) {
      setAvailabilityPreviewSlots([]);
      setLoadingAvailabilityPreview(false);
      return;
    }

    setLoadingAvailabilityPreview(true);
    const start = new Date(`${matrixStartDate}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 5);

    const data = await listAvailableSlots({
      businessId,
      tourId: selectedTourId,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    });

    setAvailabilityPreviewSlots((data || []) as AvailabilityPreviewSlot[]);
    setLoadingAvailabilityPreview(false);
  }

  async function loadAddOns() {
    if (!businessId) return;
    const { data } = await supabase
      .from("add_ons")
      .select("id, name, description, price, image_url")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("sort_order");
    setAvailableAddOns((data || []) as AddOn[]);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      loadTours();
      loadBusinessSettings();
      loadAddOns();
    }, 0);
    return () => clearTimeout(t);
  }, [businessId]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadSlots();
    }, 0);
    return () => clearTimeout(t);
  }, [bookingDate, selectedTourId, businessId]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadAvailabilityPreview();
    }, 0);
    return () => clearTimeout(t);
  }, [matrixStartDate, selectedTourId, businessId]);

  const selectedTour = useMemo(() => tours.find((t) => t.id === selectedTourId) || null, [tours, selectedTourId]);
  const selectedSlot = useMemo(() => slots.find((s) => s.id === selectedSlotId) || null, [slots, selectedSlotId]);
  const qty = Math.max(0, Number(adults) || 0) + Math.max(0, Number(children) || 0);
  const unitPrice = Number(
    selectedSlot?.price_per_person_override ??
    selectedTour?.peak_price_per_person ??
    selectedTour?.base_price_per_person ??
    0
  );
  const baseTotal = qty * unitPrice;
  const addOnsTotal = useMemo(() => availableAddOns.reduce((sum, ao) => sum + (selectedAddOns[ao.id] || 0) * ao.price, 0), [availableAddOns, selectedAddOns]);
  const grandTotal = baseTotal + addOnsTotal;
  const discountNum = Math.max(0, Number(discountValue) || 0);
  const promoDiscountCalc = discountType === "promo" && promoResult?.valid
    ? promoResult.discount_type === "PERCENT"
      ? grandTotal * (Number(promoResult.discount_value) / 100)
      : Math.min(Number(promoResult.discount_value), grandTotal)
    : 0;
  // Manual override replaces the *tour subtotal*, but add-ons stay on top.
  // Otherwise admins applying a staff discount silently lose add-on revenue
  // (and the customer ends up with paid add-ons that aren't in total_amount).
  const totalAmount = discountType === "manual"
    ? Math.max(0, discountNum + addOnsTotal)
    : Math.max(0, grandTotal - promoDiscountCalc);
  const availableSlots = slots.filter((s) => {
    const avail = Math.max(Number(s.available_capacity || 0), 0);
    return avail > 0 && (qty <= 0 || avail >= qty);
  });
  const availableSeats = availableSlots.reduce((sum, s) => sum + Math.max((s.capacity_total || 0) - (s.booked || 0), 0), 0);
  const availabilityDays = useMemo(
    () => Array.from({ length: 5 }, (_, index) => addDays(matrixStartDate, index)),
    [matrixStartDate],
  );
  const availabilityTimeRows = useMemo(() => {
    const dayMap = new Map<string, Map<string, number>>();
    const timeSet = new Set<string>();

    for (const slot of availabilityPreviewSlots) {
      const day = dateKey(slot.start_time);
      const time = fmtTime(slot.start_time);
      const available = Math.max(Number(slot.available_capacity || 0), 0);
      if (!dayMap.has(day)) dayMap.set(day, new Map());
      const times = dayMap.get(day)!;
      times.set(time, (times.get(time) || 0) + available);
      timeSet.add(time);
    }

    return Array.from(timeSet)
      .sort((a, b) => a.localeCompare(b))
      .map((time) => ({
        time,
        days: availabilityDays.map((day) => {
          const slot = availabilityPreviewSlots.find(s => dateKey(s.start_time) === day && fmtTime(s.start_time) === time);
          const available = slot ? Math.max(Number(slot.available_capacity || 0), 0) : 0;
          return {
            day,
            available,
            isAvailable: qty <= 0 ? available > 0 : available >= qty,
            slotId: slot?.id || null,
          };
        }),
      }));
  }, [availabilityPreviewSlots, availabilityDays, qty]);

  async function createBooking() {
    console.log("[NEW_BOOKING] createBooking started", { selectedTourId, selectedSlotId, bookingDate, qty, customerName, status, totalAmount });
    setMissingField(null);
    const missingFields = [];

    if (!selectedTourId) missingFields.push("tour");
    if (!bookingDate) missingFields.push("date");
    if (!selectedSlotId) missingFields.push("slot");
    if (qty <= 0) missingFields.push("pax");
    if (!customerName.trim()) missingFields.push("name");

    // International mobile validation
    const mobileTrimmed = mobile.trim();
    if (!mobileTrimmed) {
      missingFields.push("mobile");
    } else if (!/^\+(\d{1,3})/.test(mobileTrimmed)) {
      missingFields.push("mobile_format");
    }

    if (!email.trim()) missingFields.push("email");
    if (discountType === "manual" && !discountReason.trim()) missingFields.push("discount_reason");
    for (const field of customFieldDefinitions) {
      if (field.required && !String(customFieldValues[field.key] || "").trim()) {
        missingFields.push(`custom_${field.key}`);
      }
    }

    if (missingFields.length > 0) {
      console.log("[NEW_BOOKING] createBooking validation failed", { missingFields });
      setMissingField(missingFields[0]);
      // Always surface a toast so admins don't get a silent no-op when fields
      // are missing. Field-level highlighting still happens via missingField.
      const fieldLabels: Record<string, string> = {
        tour: "Tour",
        date: "Date",
        slot: "Time slot",
        pax: "Number of guests",
        name: "Customer name",
        mobile: "Mobile number",
        mobile_format: "Mobile number (needs country code)",
        email: "Email",
        discount_reason: "Override reason",
      };
      const customLabel = (key: string) => {
        if (!key.startsWith("custom_")) return key;
        const def = customFieldDefinitions.find((f) => `custom_${f.key}` === key);
        return def?.label || key.replace("custom_", "");
      };
      const labels = missingFields.map((f) => fieldLabels[f] || customLabel(f));
      if (missingFields.includes("mobile_format")) {
        notify({
          title: "Invalid mobile format",
          message: "Please include the correct international country code for the mobile number (for example +27 or +44).",
          tone: "warning",
        });
      } else {
        notify({
          title: "Missing required field" + (labels.length > 1 ? "s" : ""),
          message: "Please fill in: " + labels.join(", "),
          tone: "warning",
        });
      }
      return;
    }

    // Warn if SA phone number looks invalid (should be 11+ digits after normalization)
    const normalizedMobile = normalizePhone(mobileTrimmed);
    if (normalizedMobile.startsWith("27") && normalizedMobile.length < 11) {
      if (!await confirmAction({
        title: "Confirm mobile number",
        message: "The mobile number looks too short for a South African number (" + normalizedMobile + "). Continue anyway?",
        tone: "warning",
        confirmLabel: "Continue",
      })) {
        return;
      }
    }

    if (selectedSlot && Math.max(Number(selectedSlot.available_capacity || 0), 0) < qty) {
      setSubmitting(false);
      notify({
        title: "Slot no longer available",
        message: "That slot no longer has enough shared capacity for this party size. Please choose another time.",
        tone: "warning",
      });
      return;
    }

    setSubmitting(true);
    setResult("");
    try {
      const bookingId = crypto.randomUUID();
      const adminName = localStorage.getItem("ck_admin_name") || localStorage.getItem("ck_admin_email") || "Admin";
      const adminEmail = localStorage.getItem("ck_admin_email") || "";
      const insertPayload: Record<string, unknown> = {
        id: bookingId,
        business_id: businessId,
        tour_id: selectedTourId,
        slot_id: selectedSlotId,
        customer_name: customerName.trim(),
        phone: normalizePhone(mobile),
        email: email.trim().toLowerCase(),
        qty,
        unit_price: unitPrice,
        total_amount: totalAmount,
        status,
        source: "ADMIN",
        created_by_admin_name: adminName,
        created_by_admin_email: adminEmail,
      };

      // Set payment deadline for PENDING bookings based on hold duration
      if (status === "PENDING") {
        insertPayload.payment_deadline = new Date(Date.now() + Number(holdHours) * 3600000).toISOString();
      }

      if (discountType === "manual") {
        insertPayload.original_total = grandTotal;
        insertPayload.discount_type = "MANUAL";
        insertPayload.discount_amount = Math.max(0, grandTotal - totalAmount);
        insertPayload.discount_notes = discountReason.trim();
      } else if (discountType === "promo" && promoResult?.valid) {
        insertPayload.promo_code = promoResult.code;
        insertPayload.discount_amount = promoDiscountCalc;
        insertPayload.original_total = grandTotal;
      }

      insertPayload.custom_fields = customFieldDefinitions.reduce<Record<string, string>>((acc, field) => {
        const value = String(customFieldValues[field.key] || "").trim();
        if (value) acc[field.key] = value;
        return acc;
      }, {});

      const { data: createdBooking, error: insertError } = await supabase
        .from("bookings")
        .insert(insertPayload)
        .select("id, business_id, waiver_status, waiver_token")
        .single();
      if (insertError || !createdBooking) {
        console.error("[NEW_BOOKING] createBooking insert error", insertError);
        setSubmitting(false);
        notify({ title: "Booking creation failed", message: formatSupabaseError(insertError), tone: "error" });
        return;
      }

      // Save add-on line items (snapshot pricing at booking time)
      const addOnRows = availableAddOns
        .filter(ao => (selectedAddOns[ao.id] || 0) > 0)
        .map(ao => ({ booking_id: bookingId, add_on_id: ao.id, qty: selectedAddOns[ao.id], unit_price: ao.price }));
      if (addOnRows.length > 0) {
        await supabase.from("booking_add_ons").insert(addOnRows);
      }

      // Record promo usage if applied
      if (discountType === "promo" && promoResult?.valid && promoResult.promo_id) {
        const { error: promoErr } = await supabase.rpc("apply_promo_code", {
          p_promo_id: promoResult.promo_id,
          p_customer_email: email.trim().toLowerCase(),
          p_booking_id: createdBooking.id,
        });
        if (promoErr) console.error("Promo apply error:", promoErr);
      }

      const ref = createdBooking.id.substring(0, 8).toUpperCase();
      const slotObj = slots.find((s) => s.id === selectedSlotId);
      const tourObj = tours.find((t) => t.id === selectedTourId);
      const slotTimeLabel = slotObj?.start_time
        ? new Date(slotObj.start_time).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() })
        : "TBC";
      const tourDateLabel = slotObj?.start_time
        ? new Date(slotObj.start_time).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: getAdminTimezone() })
        : "TBC";
      const mapsUrl = "https://www.google.com/maps/search/?api=1&query=Cape+Kayak+Adventures%2C+180+Beach+Rd%2C+Three+Anchor+Bay%2C+Cape+Town%2C+8005";

      // ── Create invoice for every booking ──
      let invoiceNumber = ref;
      try {
        const invNumRes = await supabase.rpc("next_invoice_number", { p_business_id: businessId });
        invoiceNumber = invNumRes.data || ref;
        const subtotal = grandTotal;
        const discountAmt = Math.max(0, subtotal - totalAmount);

        const invPayload: Record<string, unknown> = {
          business_id: businessId,
          booking_id: bookingId,
          invoice_number: invoiceNumber,
          customer_name: customerName.trim(),
          customer_email: email.trim().toLowerCase(),
          customer_phone: normalizePhone(mobile),
          tour_name: tourObj?.name || "Tour",
          tour_date: slotObj?.start_time || null,
          qty,
          unit_price: unitPrice,
          subtotal,
          total_amount: totalAmount,
          payment_method: status === "PAID" ? "Admin (Manual)" : "Pending",
          discount_type: discountType === "manual" ? "MANUAL" : null,
          discount_percent: 0,
          discount_amount: discountAmt,
          discount_notes: discountType === "manual" ? discountReason.trim() : null,
        };

        const { data: invData } = await supabase.from("invoices").insert(invPayload).select("id").single();
        if (invData?.id) {
          await supabase.from("bookings").update({ invoice_id: invData.id }).eq("id", bookingId);
        }
      } catch (invErr) {
        console.error("Invoice creation failed:", invErr);
      }

      // ── Auto-send payment link for PENDING bookings ──
      let paymentLinkSent = false;
      if (status === "PENDING" && email.trim() && totalAmount > 0) {
        try {
          const checkoutRes = await supabase.functions.invoke("create-checkout", {
            body: {
              amount: totalAmount,
              booking_id: bookingId,
              type: "BOOKING",
              customer_name: customerName.trim(),
              qty,
              skip_notifications: true, // admin dashboard sends its own notifications below
            },
          });
          const checkoutData = checkoutRes.data;
          if (checkoutRes.error) {
            let checkoutErrDetail = checkoutRes.error.message;
            try {
              const errBody = await (checkoutRes.error as any).context?.json?.();
              if (errBody?.error) checkoutErrDetail = errBody.error;
              if (errBody?.reason) checkoutErrDetail += " — " + errBody.reason;
            } catch { /* ignore parse error */ }
            console.error("Auto payment link failed (checkout):", checkoutErrDetail);
            notify({ title: "Payment link failed", message: "Could not create checkout: " + checkoutErrDetail + ". You can resend from the bookings page.", tone: "error", duration: 8000 });
          } else if (checkoutData?.redirectUrl) {
            // Send payment link email
            try {
              const emailRes = await supabase.functions.invoke("send-email", {
                body: {
                  type: "PAYMENT_LINK",
                  data: {
                    email: email.trim().toLowerCase(),
                    booking_id: createdBooking.id,
                    business_id: createdBooking.business_id,
                    waiver_status: createdBooking.waiver_status,
                    waiver_token: createdBooking.waiver_token,
                    customer_name: customerName.trim(),
                    ref,
                    tour_name: tourObj?.name || "Tour",
                    tour_date: tourDateLabel,
                    qty,
                    total_amount: totalAmount.toFixed(2),
                    payment_url: checkoutData.redirectUrl,
                  },
                },
              });
              // send-email returns HTTP 200 even when Resend rejects the send
              // (body carries { ok:false }). Treat that as a failure too, else
              // staff see "Payment link emailed" while the customer gets nothing.
              const sendFailed = emailRes.error || emailRes.data?.ok === false;
              if (sendFailed) {
                const detail = emailRes.error?.message || emailRes.data?.message || emailRes.data?.error || "unknown error";
                console.error("Payment link email error:", detail, emailRes.data);
                Sentry.captureException(new Error("Payment link email failed: " + detail), {
                  extra: { booking_id: createdBooking.id, ref, email: email.trim().toLowerCase(), resend: emailRes.data },
                });
                notify({ title: "Payment email failed", message: "Email could not be sent: " + detail + ". Resend from bookings page.", tone: "error", duration: 8000 });
              } else {
                paymentLinkSent = true;
              }
            } catch (emailErr) {
              console.error("Payment link email failed:", emailErr);
              Sentry.captureException(emailErr, { extra: { booking_id: createdBooking.id, ref, stage: "payment_link_email" } });
              notify({ title: "Payment email failed", message: "Email send threw an error. Resend from bookings page.", tone: "error", duration: 8000 });
            }

            // Send WhatsApp with payment link
            if (mobile.trim()) {
              try {
                const firstName = customerName.trim().split(" ")[0] || "there";
                await supabase.functions.invoke("send-whatsapp-text", {
                  body: {
                    to: normalizePhone(mobile),
                    business_id: businessId,
                    message:
                      "Hi " + firstName + "!\n\n" +
                      "Here\u2019s your payment link to confirm your booking:\n\n" +
                      "\u{1F6F6} " + (tourObj?.name || "Tour") + "\n" +
                      "\u{1F4C5} " + slotTimeLabel + "\n" +
                      "\u{1F465} " + qty + " people\n" +
                      "\u{1F4B0} R" + totalAmount.toFixed(2) + "\n\n" +
                      "\u{1F517} Pay here: " + checkoutData.redirectUrl + "\n\n" +
                      "\u23F0 Please complete payment within " + holdHours + " hours to secure your spot.",
                  },
                });
              } catch (waErr) {
                console.error("Payment link WhatsApp failed:", waErr);
              }
            }
          } else {
            notify({ title: "Payment link failed", message: "Checkout did not return a payment URL. Resend from bookings page.", tone: "error", duration: 8000 });
          }
        } catch (err) {
          console.error("Auto payment link flow failed:", err);
          notify({ title: "Payment link failed", message: "Payment link flow failed: " + (err instanceof Error ? err.message : String(err)), tone: "error", duration: 8000 });
        }
      }

      // Only send confirmation email + WhatsApp for completed bookings (PAID/CONFIRMED).
      // PENDING/HELD bookings will get confirmed by the Yoco webhook after payment.
      if (status === "PAID" || status === "CONFIRMED") {
        if (email.trim()) {
          try {
            const confirmRes = await supabase.functions.invoke("send-email", {
              body: {
                type: "BOOKING_CONFIRM",
                data: {
                  booking_id: createdBooking.id,
                  business_id: createdBooking.business_id,
                  waiver_status: createdBooking.waiver_status,
                  waiver_token: createdBooking.waiver_token,
                  email: email.trim().toLowerCase(),
                  customer_name: customerName.trim(),
                  ref,
                  tour_name: tourObj?.name || "Tour",
                  start_time: slotTimeLabel,
                  qty,
                  total_amount: totalAmount.toFixed(2),
                },
              },
            });
            const confirmFailed = confirmRes.error || confirmRes.data?.ok === false;
            if (confirmFailed) {
              const detail = confirmRes.error?.message || confirmRes.data?.message || confirmRes.data?.error || "unknown";
              console.error("Confirmation email error:", detail, confirmRes.data);
              Sentry.captureException(new Error("Confirmation email failed: " + detail), {
                extra: { booking_id: createdBooking.id, ref, email: email.trim().toLowerCase(), resend: confirmRes.data },
              });
              notify({ title: "Confirmation email failed", message: "Error: " + detail + ". Resend from bookings page.", tone: "error", duration: 8000 });
            }
          } catch (e) {
            console.error("Confirmation email failed:", e);
            Sentry.captureException(e, { extra: { booking_id: createdBooking.id, ref, stage: "confirmation_email" } });
            notify({ title: "Confirmation email failed", message: "Could not send confirmation email. Resend from bookings page.", tone: "error", duration: 8000 });
          }

          // Send invoice email with pro forma PDF attachment
          try {
            const invoiceRes = await supabase.functions.invoke("send-email", {
              body: {
                type: "INVOICE",
                data: {
                  business_id: businessId,
                  email: email.trim().toLowerCase(),
                  customer_name: customerName.trim(),
                  customer_email: email.trim().toLowerCase(),
                  invoice_number: invoiceNumber,
                  invoice_date: tourDateLabel,
                  tour_name: tourObj?.name || "Tour",
                  tour_date: tourDateLabel,
                  qty,
                  unit_price: unitPrice.toFixed(2),
                  subtotal: baseTotal.toFixed(2),
                  total_amount: totalAmount.toFixed(2),
                  payment_method: "Admin (Manual)",
                  payment_reference: ref,
                },
              },
            });
            const invoiceFailed = invoiceRes.error || invoiceRes.data?.ok === false;
            if (invoiceFailed) {
              const detail = invoiceRes.error?.message || invoiceRes.data?.message || invoiceRes.data?.error || "unknown";
              console.error("Invoice email error:", detail, invoiceRes.data);
              Sentry.captureException(new Error("Invoice email failed: " + detail), {
                extra: { booking_id: createdBooking.id, ref, invoice_number: invoiceNumber, email: email.trim().toLowerCase(), resend: invoiceRes.data },
              });
            }
          } catch (e) {
            console.error("Invoice email failed:", e);
            Sentry.captureException(e, { extra: { booking_id: createdBooking.id, ref, invoice_number: invoiceNumber, stage: "invoice_email" } });
          }
        }

        if (mobile.trim()) {
          try {
            await supabase.functions.invoke("send-whatsapp-text", {
              body: {
                to: normalizePhone(mobile),
                business_id: businessId,
                message: "\u{1F389} *Booking Confirmed!*\n\n" +
                  "\u{1F4CB} Ref: " + ref + "\n" +
                  "\u{1F6F6} " + (tourObj?.name || "Tour") + "\n" +
                  "\u{1F4C5} " + slotTimeLabel + "\n" +
                  "\u{1F465} " + qty + " people\n" +
                  "\u{1F4B0} R" + totalAmount.toFixed(2) + "\n\n" +
                  "\u{1F4CD} *Meeting Point:*\nCape Kayak Adventures\n180 Beach Rd, Three Anchor Bay, Cape Town, 8005\nArrive 15 min early\n\n" +
                  "\u{1F5FA} " + mapsUrl + "\n\n" +
                  "\u{1F392} *Bring:* Sunscreen, hat, towel, water bottle\n\n" +
                  "We can\u2019t wait to see you! \u{1F30A}",
              },
            });
          } catch (e) {
            console.error("WhatsApp confirmation failed:", e);
          }
        }
      }

      console.log("[NEW_BOOKING] createBooking success", { bookingId, ref, status, paymentLinkSent });
      notify({
        title: "Booking created",
        message: status === "PENDING" && paymentLinkSent
          ? `Ref ${ref}. Payment link emailed to ${email.trim().toLowerCase()}.`
          : status === "PENDING"
            ? `Ref ${ref}. Payment link could not be sent; re-send it from the bookings page.`
            : `Ref ${ref}.`,
        tone: "success",
        duration: 7000,
      });
      router.push("/bookings");

      setCustomerName("");
      setMobile("");
      setEmail("");
      setAdults("0");
      setChildren("0");
      setSelectedSlotId("");
      setSelectedAddOns({});
      setDiscountType("none");
      setDiscountValue("0");
      setCustomFieldValues(customFieldDefinitions.reduce<Record<string, string>>((acc, field) => {
        acc[field.key] = "";
        return acc;
      }, {}));
      loadSlots();
    } catch (err: unknown) {
      console.error("[NEW_BOOKING] createBooking error", err);
      notify({ title: "Booking creation failed", message: err instanceof Error ? err.message : String(err), tone: "error" });
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="anim-fade-up">
        <p className="ui-mono-label mb-2">Operations</p>
        <h2 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>New Booking</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--ck-text-muted)" }}>Create manual bookings and send confirmation with payment link.</p>
      </div>

      <div className="ui-card anim-fade-up anim-d1 p-5">
        <h3 className="mb-4 text-xl font-medium" style={{ color: "var(--ck-text-strong)" }}>Activity Details</h3>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto]">
          {/* Left: tour + pax selectors */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-1">
              <label className="text-sm font-semibold text-[var(--ck-text)] flex items-center gap-1.5">
                To attend <span className="text-[var(--ck-danger)]">*</span>
              </label>
              <CustomSelect
                placeholder="Choose a service"
                value={selectedTourId}
                options={tours.map((t) => ({ id: t.id, name: t.name }))}
                onChange={(id) => { setSelectedTourId(id); setMissingField(null); }}
                error={missingField === "tour"}
              />
            </div>

            <CustomNumberInput
              label="Adults *"
              value={adults}
              onChange={(v) => { setAdults(v); setMissingField(null); }}
              error={missingField === "pax"}
            />

            <CustomNumberInput
              label="Children"
              value={children}
              onChange={(v) => { setChildren(v); setMissingField(null); }}
            />
          </div>

          {/* Right: availability calendar */}
          <div className="flex w-full flex-col items-center lg:max-w-[340px]">
            <label className={`text-sm mb-1 self-start ${missingField === "date" ? "text-[var(--ck-danger)] font-medium" : "text-gray-600"}`}>Select date <span className="text-[var(--ck-danger)]">*</span></label>
            <div className={`w-full overflow-x-auto rounded-xl transition-colors ${missingField === "date" ? "ring-2 ring-[var(--ck-danger)]" : ""}`}>
              <AvailabilityCalendar
                value={bookingDate}
                onChange={(v) => { setBookingDate(v); setMatrixStartDate(v); setMissingField(null); }}
                tourId={selectedTourId}
                businessId={businessId}
                minQty={qty}
              />
            </div>

            {/* Slot color legend */}
            {availableSlots.length > 0 && (
              <div className="mt-4 flex w-full flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
                <p className="ui-mono-label mb-1 !text-[10px]">Time Slots Available</p>
                {availableSlots.slice(0, 4).map((slot, i) => {
                  const available = Math.max((slot.capacity_total || 0) - (slot.booked || 0), 0);
                  const color = ["var(--ck-chart-1)", "var(--ck-chart-2)", "var(--ck-chart-3)", "var(--ck-chart-4)"][i] || "var(--ck-text-muted)";
                  return (
                    <div key={slot.id} className="flex items-center gap-2 text-sm" style={{ color: "var(--ck-text)" }}>
                      <span style={{ backgroundColor: color }} className="w-3 h-3 rounded-full shrink-0"></span>
                      <span className="font-medium tabular-nums">{available} available</span>
                      <span style={{ color: "var(--ck-text-muted)" }}>for the {fmtTime(slot.start_time)} slot</span>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>

        <div className="mt-6">
          {loadingAvailabilityPreview ? (
            <div className="space-y-2">
              <div className="ui-skeleton h-9 w-full" />
              <div className="ui-skeleton h-[168px] w-full !rounded-2xl" />
            </div>
          ) : availabilityTimeRows.length === 0 ? (
            <div className="ui-card">
              <div className="ui-empty">
                <span className="ui-icon-chip"><CalendarBlank size={19} /></span>
                <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No open availability</p>
                <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Nothing open for the next 5 days on this activity.</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto pb-2 scrollbar-hide">
              <div className="ui-card min-w-[760px] overflow-hidden !rounded-2xl">
                <div className="grid grid-cols-[120px_repeat(5,minmax(120px,1fr))]" style={{ background: "var(--ck-surface-sunken)" }}>
                  <div className="sticky left-0 z-10 flex items-center px-4 py-3 backdrop-blur-sm" style={{ background: "var(--ck-surface-sunken)" }}>
                    <span className="ui-mono-label !text-[10px]">Timeslot</span>
                  </div>
                  {availabilityDays.map((day) => (
                    <div key={day} className="px-3 py-3 text-center" style={{ borderLeft: "1px solid var(--ck-border-subtle)" }}>
                      <p className="ui-mono-label !text-[9px]">{formatWeekdayLabel(day).substring(0, 3)}</p>
                      <p className="text-sm font-bold" style={{ color: "var(--ck-text-strong)" }}>{formatDayLabel(day)}</p>
                    </div>
                  ))}
                </div>

                {availabilityTimeRows.map((row) => (
                  <div key={row.time} className="grid grid-cols-[120px_repeat(5,minmax(120px,1fr))]" style={{ borderTop: "1px solid var(--ck-border-subtle)" }}>
                    <div className="sticky left-0 z-10 flex items-center px-4 py-4 backdrop-blur-sm" style={{ background: "color-mix(in srgb, var(--ck-surface) 90%, transparent)" }}>
                      <span className="text-sm font-bold tabular-nums" style={{ color: "var(--ck-text)" }}>{row.time}</span>
                    </div>
                    {row.days.map((cell) => {
                      const isSelected = selectedSlotId === cell.slotId && bookingDate === cell.day;
                      return (
                        <div
                          key={`${row.time}-${cell.day}`}
                          onClick={() => {
                            if (cell.slotId && cell.isAvailable) {
                              setPendingMatrixSelection({ day: cell.day, slotId: cell.slotId });
                              setBookingDate(cell.day);
                              setSelectedSlotId(cell.slotId);
                              setMissingField(null);
                              // Note: matrixStartDate is intentionally NOT changed here so
                              // the 5-day grid stays in place when selecting a different column.
                            }
                          }}
                          className={`group relative flex flex-col items-center justify-center px-3 py-3 text-center transition-all cursor-pointer ${
                            isSelected
                              ? "z-10"
                              : cell.isAvailable
                                ? ""
                                : "cursor-not-allowed overflow-hidden opacity-60"
                          }`}
                          style={{
                            borderLeft: "1px solid var(--ck-border-subtle)",
                            background: isSelected ? "var(--ck-accent)" : cell.isAvailable ? "var(--ck-accent-soft)" : "var(--ck-danger-soft)",
                            ...(isSelected ? { boxShadow: "inset 0 0 0 2px var(--ck-accent)" } : {}),
                          }}
                        >
                          <div className="text-[10px] font-bold tracking-tighter tabular-nums sm:text-xs" style={{ color: isSelected ? "#fff" : cell.isAvailable ? "var(--ck-accent)" : "var(--ck-danger)" }}>
                            {cell.available} OPEN
                          </div>

                          {!cell.isAvailable && cell.available > 0 && !isSelected && (
                            <div className="absolute inset-0 flex items-center justify-center backdrop-blur-[0.5px]" style={{ background: "var(--ck-danger-soft)" }}>
                              <span className="rounded px-1 text-[9px] font-black uppercase tracking-tighter shadow-sm" style={{ background: "var(--ck-surface)", color: "var(--ck-danger)" }}>Need {qty}</span>
                            </div>
                          )}

                          {isSelected && (
                            <div className="absolute top-1 right-1">
                              <Check size={10} style={{ color: "#fff" }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {customFieldDefinitions.length > 0 && (
          <div className="mt-6 border-t border-gray-100 pt-6">
            <h4 className="text-sm font-semibold text-[var(--ck-text)]">Additional Booking Details</h4>
            <p className="mt-1 text-xs text-gray-500">These fields are configured in Settings and saved on the booking record.</p>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {customFieldDefinitions.map((field) => {
                const value = customFieldValues[field.key] || "";
                const isTextArea = field.type === "textarea";
                const isNumber = field.type === "number";
                const hasError = missingField === `custom_${field.key}`;
                return (
                  <label key={field.key} className={`text-sm font-medium text-[var(--ck-text)] ${isTextArea ? "md:col-span-2" : ""}`}>
                    {field.label} {field.required ? <span className="text-[var(--ck-danger)]">*</span> : null}
                    {isTextArea ? (
                      <textarea
                        value={value}
                        onChange={(e) => {
                          setCustomFieldValues((current) => ({ ...current, [field.key]: e.target.value }));
                          if (hasError) setMissingField(null);
                        }}
                        placeholder={field.placeholder || ""}
                        rows={4}
                        className={`mt-1.5 w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all ${
                          hasError
                            ? "border-[var(--ck-danger)] ring-1 ring-[var(--ck-danger)]"
                            : "border-[var(--ck-border-strong)] bg-[var(--ck-surface)] hover:border-[var(--ck-accent)] focus:border-[var(--ck-accent)] focus:ring-4 focus:ring-[var(--ck-accent)]/15"
                        }`}
                      />
                    ) : (
                      <input
                        type={isNumber ? "number" : "text"}
                        value={value}
                        onChange={(e) => {
                          setCustomFieldValues((current) => ({ ...current, [field.key]: e.target.value }));
                          if (hasError) setMissingField(null);
                        }}
                        placeholder={field.placeholder || ""}
                        className={`mt-1.5 h-12 w-full rounded-xl border px-4 text-sm outline-none transition-all ${
                          hasError
                            ? "border-[var(--ck-danger)] ring-1 ring-[var(--ck-danger)]"
                            : "border-[var(--ck-border-strong)] bg-[var(--ck-surface)] hover:border-[var(--ck-accent)] focus:border-[var(--ck-accent)] focus:ring-4 focus:ring-[var(--ck-accent)]/15"
                        }`}
                      />
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="ui-card p-5">
        <h3 className="mb-4 text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>Customer Details</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="text-sm" style={{ color: "var(--ck-text)" }}>
            Full Name <span style={{ color: "var(--ck-danger)" }}>*</span>
            <input
              value={customerName}
              onChange={(e) => { setCustomerName(e.target.value); setMissingField(null); }}
              autoComplete="off"
              className={"ui-control mt-1 w-full" + (missingField === "name" ? " !border-[var(--ck-danger)]" : "")}
            />
          </label>
          <label className="text-sm" style={{ color: "var(--ck-text)" }}>
            Mobile Number <span style={{ color: "var(--ck-danger)" }}>*</span>
            <input
              type="tel"
              value={mobile}
              onChange={(e) => { setMobile(e.target.value); setMissingField(null); }}
              autoComplete="off"
              className={"ui-control mt-1 w-full" + (missingField === "mobile" || missingField === "mobile_format" ? " !border-[var(--ck-danger)]" : "")}
            />
            {(missingField === "mobile_format") && (
              <p className="mt-1 text-xs" style={{ color: "var(--ck-danger)" }}>International format required (e.g. +27)</p>
            )}
          </label>
          <label className="text-sm" style={{ color: "var(--ck-text)" }}>
            Email <span style={{ color: "var(--ck-danger)" }}>*</span>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setMissingField(null); }}
              autoComplete="off"
              className={"ui-control mt-1 w-full" + (missingField === "email" ? " !border-[var(--ck-danger)]" : "")}
            />
          </label>
        </div>
      </div>

      <div className="ui-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>Slot Availability</h3>
          <p className="ui-mono-label !text-[10px]">
            {loadingSlots ? "Loading slots…" : `${availableSlots.length} slots · ${availableSeats} seats open`}
          </p>
        </div>

        <div className="mt-1">
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--ck-text)" }}>
            Select slot time <span style={{ color: "var(--ck-danger)" }}>*</span>
          </label>
          <CustomSelect
            placeholder={availableSlots.length > 0 ? "Choose slot" : "No slots available"}
            value={selectedSlotId}
            options={availableSlots.map((slot) => {
              const available = Math.max((slot.capacity_total || 0) - (slot.booked || 0), 0);
              return {
                id: slot.id,
                name: `${fmtTime(slot.start_time)} · ${available} seats open`,
              };
            })}
            onChange={(id) => { setSelectedSlotId(id); setMissingField(null); }}
            error={missingField === "slot"}
          />
        </div>

        <div className={`mt-4 grid grid-cols-1 gap-3 ${status === "PENDING" ? "md:grid-cols-5" : "md:grid-cols-4"}`}>
          <div className="rounded-lg p-3 text-sm" style={{ background: "var(--ck-surface-sunken)" }}>
            <p className="ui-mono-label !text-[9.5px]">Qty</p>
            <p className="font-display mt-1 text-xl font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{qty}</p>
          </div>
          <div className="rounded-lg p-3 text-sm" style={{ background: "var(--ck-surface-sunken)" }}>
            <p className="ui-mono-label !text-[9.5px]">Unit Price</p>
            <p className="font-display mt-1 text-xl font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{fmtCurrency(unitPrice)}</p>
          </div>
          <div className="rounded-lg p-3 text-sm" style={{ background: "var(--ck-surface-sunken)" }}>
            <p className="ui-mono-label !text-[9.5px]">Base Total</p>
            <p className="font-display mt-1 text-xl font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{fmtCurrency(baseTotal)}</p>
          </div>
          <label className="rounded-lg p-3 text-sm" style={{ background: "var(--ck-surface-sunken)" }}>
            <span className="ui-mono-label !text-[9.5px]">Payment status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="ui-control mt-1 w-full !h-9 !px-2 !py-1.5">
              <option value="PENDING">PENDING</option>
              <option value="HELD">HELD</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="PAID">PAID</option>
            </select>
          </label>
          {status === "PENDING" && (
            <label className="rounded-lg p-3 text-sm" style={{ background: "var(--ck-surface-sunken)" }}>
              <span className="ui-mono-label !text-[9.5px]">Hold booking for</span>
              <select value={holdHours} onChange={(e) => setHoldHours(e.target.value)} className="ui-control mt-1 w-full !h-9 !px-2 !py-1.5">
                <option value="2">2 hours</option>
                <option value="6">6 hours</option>
                <option value="12">12 hours</option>
                <option value="24">24 hours</option>
                <option value="48">48 hours</option>
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Optional Add-Ons */}
      {availableAddOns.length > 0 && (
        <div className="ui-card p-5">
          <h3 className="mb-4 text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>Optional Add-Ons</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {availableAddOns.map((ao) => {
              const aoQty = selectedAddOns[ao.id] || 0;
              return (
                <div key={ao.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: "var(--ck-surface-sunken)", border: "1px solid var(--ck-border-subtle)" }}>
                  {ao.image_url && (
                    <img src={ao.image_url} alt={ao.name} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>{ao.name}</p>
                    {ao.description && <p className="truncate text-xs" style={{ color: "var(--ck-text-muted)" }}>{ao.description}</p>}
                    <p className="text-xs font-semibold tabular-nums" style={{ color: "var(--ck-amber)" }}>{fmtCurrency(ao.price)} each</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedAddOns(prev => {
                        const next = { ...prev };
                        if ((next[ao.id] || 0) > 0) next[ao.id] = (next[ao.id] || 0) - 1;
                        if (next[ao.id] === 0) delete next[ao.id];
                        return next;
                      })}
                      disabled={aoQty === 0}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold disabled:opacity-30"
                      style={{ background: "var(--ck-surface)", border: "1px solid var(--ck-border-strong)", color: "var(--ck-text)" }}
                    >-</button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{aoQty}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedAddOns(prev => ({ ...prev, [ao.id]: (prev[ao.id] || 0) + 1 }))}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold"
                      style={{ background: "var(--ck-surface)", border: "1px solid var(--ck-border-strong)", color: "var(--ck-text)" }}
                    >+</button>
                  </div>
                </div>
              );
            })}
          </div>
          {addOnsTotal > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-lg px-4 py-2 text-sm" style={{ background: "var(--ck-amber-soft)" }}>
              <span style={{ color: "var(--ck-text)" }}>Add-ons subtotal</span>
              <span className="font-semibold tabular-nums" style={{ color: "var(--ck-amber)" }}>{fmtCurrency(addOnsTotal)}</span>
            </div>
          )}
        </div>
      )}

      {/* Discount / Price Override */}
      <div className="ui-card p-5">
        <h3 className="mb-4 text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>Price Adjustment</h3>

        {/* Toggle */}
        {/* Promo code input */}
        <div className="flex items-end gap-2 mb-4">
          <label className="flex-1 text-sm" style={{ color: "var(--ck-text)" }}>
            Promo code
            <input
              type="text"
              value={promoCode}
              onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
              className="ui-control mt-1 w-full uppercase"
              placeholder="Enter promo code"
              disabled={discountType === "manual"}
            />
          </label>
          <button
            type="button"
            disabled={!promoCode.trim() || promoChecking || discountType === "manual"}
            onClick={async () => {
              setPromoChecking(true);
              const { data } = await supabase.rpc("validate_promo_code", {
                p_business_id: businessId,
                p_code: promoCode.trim(),
                p_order_amount: baseTotal,
                p_customer_email: email || null,
              });
              setPromoResult(data);
              if (data?.valid) setDiscountType("promo");
              setPromoChecking(false);
            }}
            className="ui-btn ui-btn-primary disabled:opacity-50"
          >
            {promoChecking ? "…" : "Apply"}
          </button>
          {promoResult && !promoResult.valid && (
            <span className="text-xs" style={{ color: "var(--ck-danger)" }}>{promoResult.error}</span>
          )}
        </div>

        {discountType === "promo" && promoResult?.valid && (
          <div className="mb-4 flex items-center gap-3 rounded-lg px-4 py-3 text-sm" style={{ background: "var(--ck-success-soft)", color: "var(--ck-success)" }}>
            <span className="font-semibold">{promoResult.code}</span>
            <span>— {promoResult.discount_type === "PERCENT" ? promoResult.discount_value + "% off" : "R" + promoResult.discount_value + " off"}</span>
            <button type="button" onClick={() => { setDiscountType("none"); setPromoCode(""); setPromoResult(null); }} className="ml-auto text-xs hover:underline" style={{ color: "var(--ck-danger)" }}>Remove</button>
          </div>
        )}

        <label className="flex items-center gap-3 cursor-pointer select-none mb-4">
          <input
            type="checkbox"
            checked={discountType === "manual"}
            onChange={(e) => {
              setDiscountType(e.target.checked ? "manual" : "none");
              setDiscountValue("0");
              setDiscountReason("");
              setPromoCode(""); setPromoResult(null);
            }}
            className="h-4 w-4 rounded border-gray-300 accent-[var(--ck-accent)]"
          />
          <span className="text-sm font-medium" style={{ color: "var(--ck-text)" }}>Manual price override</span>
        </label>

        {discountType === "manual" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-sm" style={{ color: "var(--ck-text)" }}>
              Override price (R) <span style={{ color: "var(--ck-danger)" }}>*</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="ui-control mt-1 w-full"
                placeholder="Enter override amount"
              />
            </label>
            <label className="text-sm" style={{ color: "var(--ck-text)" }}>
              Reason <span style={{ color: "var(--ck-danger)" }}>*</span>
              <input
                type="text"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                className={"ui-control mt-1 w-full" + (missingField === "discount_reason" ? " !border-[var(--ck-danger)]" : "")}
                placeholder="e.g. Staff discount, group deal…"
              />
              {missingField === "discount_reason" && (
                <span className="mt-1 text-xs" style={{ color: "var(--ck-danger)" }}>A reason is required for manual price overrides.</span>
              )}
            </label>
          </div>
        )}

        {discountType === "manual" && (
          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg px-4 py-3 text-sm" style={{ background: "var(--ck-amber-soft)" }}>
            <span style={{ color: "var(--ck-text-muted)" }}>Tour: <span className="line-through">{fmtCurrency(baseTotal)}</span> → {fmtCurrency(discountNum)}</span>
            {addOnsTotal > 0 && <span style={{ color: "var(--ck-text-muted)" }}>+ Add-ons {fmtCurrency(addOnsTotal)}</span>}
            <span className="font-display text-base font-bold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>→ Final: {fmtCurrency(totalAmount)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <button
          onClick={createBooking}
          disabled={submitting || loadingTours || loadingSlots}
          className="ui-btn ui-btn-primary w-full !h-11 !px-5 disabled:opacity-50 sm:w-auto"
        >
          {submitting ? "Processing…" : `Create Booking · ${fmtCurrency(totalAmount)}`}
        </button>
      </div>
    </div>
  );
}
