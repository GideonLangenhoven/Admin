"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmAction, notify } from "../lib/app-notify";
import { getAdminTimezone, zonedToUtc } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { readOperatorBookingDraft, saveOperatorBookingDraft, clearOperatorBookingDrafts } from "../lib/operator-booking-draft";
import { listAvailableSlots } from "../lib/slot-availability";
import { addDaysToDateKey, businessDayRange, isDateKey, safeSimpleReturn } from "../lib/simple-view";
import {BookingQuestions} from "../../components/booking/BookingQuestions";
import BookingSelect from "../../components/booking/BookingSelect";
import {applicableBookingQuestions, validateQuestionAnswers, captureQuestionFields, bookingCustomFieldEntries, questionErrorKey, reconcileQuestionAnswers, type BookingQuestion, type QuestionAnswers} from "../../supabase/functions/_shared/booking-custom-fields";
import AvailabilityCalendar from "../../components/AvailabilityCalendar";
import { useBusinessContext } from "../../components/BusinessContext";
import { Check, X } from "@phosphor-icons/react";
import * as Sentry from "@sentry/nextjs";
import styles from "./booking-form.module.css";

interface Tour {
  id: string;
  name: string;
  business_id: string | null;
  base_price_per_person: number | null;
  peak_price_per_person: number | null;
  meeting_point: string | null;
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

const EXTRA_PAX = "00000000-0000-0000-0000-000000000001";
const PAYMENT_ACTIONS = [
  { id: "PENDING", name: "Request payment" },
  { id: "HELD", name: "Hold places, no immediate message" },
  { id: "CONFIRMED", name: "Confirm booking, money still due" },
  { id: "PAID", name: "Payment received" },
];
let draftAuthListenerRegistered=false;

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
  return addDaysToDateKey(dateInput, days);
}

function formatDayLabel(dateInput: string) {
  return new Date(`${dateInput}T12:00:00Z`).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function formatWeekdayLabel(dateInput: string) {
  return new Date(`${dateInput}T12:00:00Z`).toLocaleDateString("en-ZA", {
    weekday: "long",
    timeZone: "UTC",
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
  return businessDayRange(dateInput, getAdminTimezone());
}

function CustomNumberInput({ label, value, onChange, error, unlimited = false }: { label: string; value: string; onChange: (v: string) => void; error?: boolean; unlimited?: boolean }) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5">
        <label htmlFor={`party-${label}`} className="text-sm font-semibold" style={{ color: "var(--ck-text)" }}>{label}</label>
      </div>
      <div className="relative mt-1.5">
        <input
          id={`party-${label}`}
          type="number"
          min="0" max={unlimited ? undefined : 50} step="1"
          aria-invalid={error || undefined}
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
      </div>
    </div>
  );
}

export default function NewBookingPage() {
  const router = useRouter();
  const { businessId, timezone, role, readOnly } = useBusinessContext();
  const [tours, setTours] = useState<Tour[]>([]);
  const [loadingTours, setLoadingTours] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [availabilityPreviewSlots, setAvailabilityPreviewSlots] = useState<AvailabilityPreviewSlot[]>([]);
  const [loadingAvailabilityPreview, setLoadingAvailabilityPreview] = useState(false);
  const [selectedTourId, setSelectedTourId] = useState("");
  const canOverride = ["ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"].includes(role) && !readOnly;
  const isExtraPax = selectedTourId === EXTRA_PAX;
  const [overrideDeparture, setOverrideDeparture] = useState(false);
  const [departureTime, setDepartureTime] = useState("");
  const [bespokeTotal, setBespokeTotal] = useState("");
  const bespoke = canOverride && (isExtraPax || overrideDeparture);
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
  const [holdHours, setHoldHours] = useState("168");
  const [discountType, setDiscountType] = useState<"none" | "manual" | "promo">("none");
  const [discountValue, setDiscountValue] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoResult, setPromoResult] = useState<{ valid: boolean; error?: string; discount_type?: string; discount_value?: number; promo_id?: string; code?: string } | null>(null);
  const [promoChecking, setPromoChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");
  const [missingField, setMissingField] = useState<string | null>(null);
  const [rawQuestions,setRawQuestions]=useState<unknown>([]);
  const questionConfig=useMemo(()=>{try{return {definitions:applicableBookingQuestions(rawQuestions,selectedTourId,businessId),error:""};}catch{return {definitions:[],error:"Booking questions unavailable. Ask an admin to check activity settings."};}},[rawQuestions,selectedTourId,businessId]);
  const customFieldDefinitions=questionConfig.definitions;
  const priorQuestions=useRef<BookingQuestion[]>([]);
  const [bizMeetingPoint, setBizMeetingPoint] = useState<string>("");
  const [customFieldValues, setCustomFieldValues] = useState<QuestionAnswers>({});
  const [availableAddOns, setAvailableAddOns] = useState<AddOn[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, number>>({});
  const [contextReady, setContextReady] = useState(false);
  const [returnTo, setReturnTo] = useState("/bookings");
  const [draftOwner,setDraftOwner]=useState("");
  const [attemptedBookingId,setAttemptedBookingId]=useState("");
  const reviewFocusRef=useRef<HTMLElement|null>(null);
  const resultFocusRef=useRef<HTMLParagraphElement|null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [sendNotifications, setSendNotifications] = useState(true);
  const [bookingCreated, setBookingCreated] = useState(false);
  const [dataError, setDataError] = useState("");
  const blockingDataError = bespoke && dataError.startsWith("Availability") ? "" : dataError;
  const submittingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const slotRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const prefillRef = useRef({ tourId: "", slotId: "" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("date");
    const requestedTour = params.get("tour") || "";
    const requestedSlot = params.get("slot") || "";
    if (isDateKey(requestedDate)) {
      setBookingDate(requestedDate);
      setMatrixStartDate(requestedDate);
    }
    prefillRef.current = {
      tourId: /^[0-9a-f-]{36}$/i.test(requestedTour) ? requestedTour : "",
      slotId: /^[0-9a-f-]{36}$/i.test(requestedSlot) ? requestedSlot : "",
    };
    setReturnTo(safeSimpleReturn(params.get("returnTo"), "/bookings"));
    setContextReady(true);
  }, []);

  useEffect(()=>{
    let active=true;
    supabase.auth.getSession().then(({data:{session}})=>{
      if(!active||!session?.user?.id)return;
      const query=new URLSearchParams(window.location.search);
      const owner=[session.user.id,businessId,query.get("date")||"global",query.get("slot")||"global"].join(":");
      const saved=readOperatorBookingDraft(owner);
      if(saved){
        setCustomerName(String(saved.customerName||""));setMobile(String(saved.mobile||""));setEmail(String(saved.email||""));
        setAdults(String(saved.adults||"0"));setChildren(String(saved.children||"0"));setStatus(String(saved.status||"PENDING"));
        setHoldHours(String(saved.holdHours||"168"));setDiscountType(saved.discountType as typeof discountType);setDiscountValue(String(saved.discountValue||"0"));setDiscountReason(String(saved.discountReason||""));
        setPromoCode(String(saved.promoCode||""));setPromoResult(saved.promoResult as typeof promoResult);
        setCustomFieldValues(saved.customFieldValues as QuestionAnswers);setSelectedAddOns(saved.selectedAddOns as Record<string,number>);
        setBookingDate(String(saved.bookingDate));setMatrixStartDate(String(saved.matrixStartDate));setSelectedTourId(String(saved.selectedTourId));
        prefillRef.current={tourId:String(saved.selectedTourId||""),slotId:String(saved.selectedSlotId||"")};
        setOverrideDeparture(saved.overrideDeparture===true);setDepartureTime(String(saved.departureTime||""));setBespokeTotal(String(saved.bespokeTotal??""));
        setSelectedSlotId(String(saved.selectedSlotId||""));setSendNotifications(saved.sendNotifications!==false);
        requestIdRef.current=typeof saved.requestId==="string"?saved.requestId:null;setAttemptedBookingId(requestIdRef.current||"");
      }
      if(!saved){
        const pending=sessionStorage.getItem("operator-booking-request:"+owner);
        if(pending&&/^[0-9a-f-]{36}$/i.test(pending)){requestIdRef.current=pending;setAttemptedBookingId(pending);}
      }
      setDraftOwner(owner);
    });
    if(!draftAuthListenerRegistered){
      draftAuthListenerRegistered=true;
      supabase.auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT")clearOperatorBookingDrafts();});
    }
    return()=>{active=false;};
  },[businessId]);

  useEffect(()=>{
    if(!draftOwner||!contextReady)return;
    if(bookingCreated)return;
    if(attemptedBookingId)sessionStorage.setItem("operator-booking-request:"+draftOwner,attemptedBookingId);
    saveOperatorBookingDraft(draftOwner,{customerName,mobile,email,adults,children,status,holdHours,discountType,discountValue,discountReason,promoCode,promoResult,customFieldValues,selectedAddOns,bookingDate,matrixStartDate,selectedTourId,selectedSlotId,overrideDeparture,departureTime,bespokeTotal,sendNotifications,requestId:attemptedBookingId||null});
  },[draftOwner,contextReady,bookingCreated,customerName,mobile,email,adults,children,status,holdHours,discountType,discountValue,discountReason,promoCode,promoResult,customFieldValues,selectedAddOns,bookingDate,matrixStartDate,selectedTourId,selectedSlotId,overrideDeparture,departureTime,bespokeTotal,sendNotifications,attemptedBookingId]);

  useEffect(()=>{if(reviewing)reviewFocusRef.current?.focus();},[reviewing]);
  useEffect(()=>{if(result)resultFocusRef.current?.focus();},[result]);

  function openCreatedBooking(booking: { id: string; start_time: string }) {
    setBookingCreated(true);
    clearOperatorBookingDrafts(draftOwner);
    sessionStorage.removeItem("operator-booking-request:" + draftOwner);
    const date = dateKey(booking.start_time);
    router.replace(`/bookings?date=${date}&booking=${encodeURIComponent(booking.id)}`);
  }

  function formatSupabaseError(err: { message?: string; details?: string; hint?: string; code?: string } | null) {
    if (!err) return "Unknown error";
    return err.message || "Booking data could not be saved";
  }

  // Outer catch below can receive an Error, a string, or a plain error body
  // from an edge function (e.g. create-checkout's {error, reason, details}).
  // String(err) on that last case renders literally "[object Object]" in the
  // toast — extract a real message instead of falling through to that.
  function formatCaughtError(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      const msg = e.reason || e.error || e.message || e.details;
      if (typeof msg === "string") return msg;
      try { return JSON.stringify(err); } catch { /* fall through */ }
    }
    return String(err);
  }

  async function loadTours() {
    setLoadingTours(true);
    const { data, error } = await supabase
      .from("tours")
      .select("id, name, business_id, base_price_per_person, peak_price_per_person, meeting_point")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error) { setDataError("Activities unavailable. Refresh before booking."); setLoadingTours(false); return; }
    const rows = (data || []) as Tour[];
    setTours(rows);
    setSelectedTourId((current) => {
      if (current) return current;
      const requested = prefillRef.current.tourId;
      return requested ? (rows.some((tour) => tour.id === requested) ? requested : "") : rows[0]?.id || "";
    });
    setLoadingTours(false);
  }

  useEffect(()=>{
    const previous=priorQuestions.current;
    if(previous.length)setCustomFieldValues(values=>reconcileQuestionAnswers(previous,customFieldDefinitions,values).answers);
    priorQuestions.current=customFieldDefinitions;
  },[customFieldDefinitions]);

  async function loadBusinessSettings() {
    if (!businessId) return;
    const { data, error } = await supabase
      .from("businesses")
      .select("booking_custom_fields, meeting_point, meeting_point_address")
      .eq("id", businessId)
      .maybeSingle();

    if (error || !data) { setDataError("Booking settings unavailable. Refresh before booking."); return; }
    setBizMeetingPoint(String(data?.meeting_point || data?.meeting_point_address || "").trim());
    setRawQuestions(data.booking_custom_fields ?? []);
  }

  async function loadSlots() {
    if (bespoke || !bookingDate || !selectedTourId || !businessId) { setSlots([]); setLoadingSlots(false); return; }
    const request = ++slotRequestRef.current;
    setLoadingSlots(true);
    setSlots([]);
    try {
    const { startIso, endIso } = dayRange(bookingDate);
    const nextSlots = await listAvailableSlots({
      businessId,
      startIso,
      endIso,
      tourId: selectedTourId || null,
    }) as Slot[];
    if (request !== slotRequestRef.current) return;
    setSlots(nextSlots);
    const requestedSlotId = prefillRef.current.slotId;
    const matrixSelection = pendingMatrixSelection;
    setSelectedSlotId((current) => {
      const desiredSlotId = matrixSelection?.day === bookingDate
        ? matrixSelection.slotId
        : requestedSlotId || current;
      if (desiredSlotId && nextSlots.some((slot) => slot.id === desiredSlotId)) return desiredSlotId;
      return current && nextSlots.some((slot) => slot.id === current) ? current : "";
    });
    if (prefillRef.current.slotId && nextSlots.some((slot) => slot.id === prefillRef.current.slotId)) {
      prefillRef.current.slotId = "";
    }
    if (pendingMatrixSelection?.day === bookingDate) {
      setPendingMatrixSelection(null);
    }
    } catch {
      if (request === slotRequestRef.current) { setSlots([]); setDataError("Availability unconfirmed. Refresh before booking."); }
    } finally { if (request === slotRequestRef.current) setLoadingSlots(false); }
  }

  async function loadAvailabilityPreview() {
    if (bespoke || !matrixStartDate || !businessId || !selectedTourId) {
      setAvailabilityPreviewSlots([]);
      setLoadingAvailabilityPreview(false);
      return;
    }

    const request = ++previewRequestRef.current;
    setLoadingAvailabilityPreview(true);
    try {
    const { startIso } = businessDayRange(matrixStartDate, getAdminTimezone());
    const { startIso: endIso } = businessDayRange(addDays(matrixStartDate, 5), getAdminTimezone());

    const data = await listAvailableSlots({
      businessId,
      tourId: selectedTourId,
      startIso,
      endIso,
    });

    if (request === previewRequestRef.current) setAvailabilityPreviewSlots((data || []) as AvailabilityPreviewSlot[]);
    } catch {
      if (request === previewRequestRef.current) { setAvailabilityPreviewSlots([]); setDataError("Availability preview unavailable. Refresh before booking."); }
    } finally { if (request === previewRequestRef.current) setLoadingAvailabilityPreview(false); }
  }

  async function loadAddOns() {
    if (!businessId) return;
    const { data, error } = await supabase
      .from("add_ons")
      .select("id, name, description, price, image_url")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("sort_order");
    if (error) { setDataError("Extras unavailable. Refresh before booking."); return; }
    setAvailableAddOns((data || []) as AddOn[]);
  }

  useEffect(() => {
    if (!contextReady) return;
    const t = setTimeout(() => {
      loadTours();
      loadBusinessSettings();
      loadAddOns();
    }, 0);
    return () => clearTimeout(t);
  }, [businessId, contextReady]);

  useEffect(() => {
    if (!contextReady) return;
    const t = setTimeout(() => {
      loadSlots();
    }, 0);
    return () => clearTimeout(t);
  }, [bookingDate, selectedTourId, businessId, contextReady, bespoke]);

  useEffect(() => {
    if (!contextReady) return;
    const t = setTimeout(() => {
      loadAvailabilityPreview();
    }, 0);
    return () => clearTimeout(t);
  }, [matrixStartDate, selectedTourId, businessId, contextReady, bespoke]);

  const selectedTour = useMemo(() => isExtraPax && canOverride
    ? { id: EXTRA_PAX, name: "Extra pax", business_id: businessId, base_price_per_person: 0, peak_price_per_person: null, meeting_point: null }
    : tours.find((t) => t.id === selectedTourId) || null, [tours, selectedTourId, isExtraPax, canOverride, businessId]);
  const departureIso = bespoke && isDateKey(bookingDate) && /^([01]\d|2[0-3]):[0-5]\d$/.test(departureTime)
    ? new Date(zonedToUtc(`${bookingDate}T${departureTime}:00`, timezone)).toISOString() : "";
  const selectedSlot = useMemo(() => slots.find((s) => s.id === selectedSlotId) || null, [slots, selectedSlotId]);
  const qty = Math.max(0, Number(adults) || 0) + Math.max(0, Number(children) || 0);
  const rawUnitPrice=selectedSlot?.price_per_person_override ?? selectedTour?.base_price_per_person;
  const priceUnavailable=!bespoke&&!!selectedTour&&(rawUnitPrice==null||!Number.isFinite(Number(rawUnitPrice))||Number(rawUnitPrice)<0);
  const unitPrice=priceUnavailable?0:Number(rawUnitPrice??0);
  const baseTotal = bespoke ? Number(bespokeTotal) || 0 : qty * unitPrice;
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
  const unroundedTotal = bespoke ? baseTotal + addOnsTotal : discountType === "manual"
    ? Math.max(0, discountNum + addOnsTotal)
    : Math.max(0, grandTotal - promoDiscountCalc);
  const totalAmount = Math.round((unroundedTotal + Number.EPSILON) * 100) / 100;
  const availableSlots = slots.filter((s) => {
    const avail = Math.max(Number(s.available_capacity || 0), 0);
    return avail > 0 && (qty <= 0 || avail >= qty);
  });
  const availableSeats = availableSlots.reduce((sum, s) => sum + Math.max(Number(s.available_capacity || 0), 0), 0);
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
    if (submittingRef.current || readOnly || blockingDataError || priceUnavailable || bookingCreated) return;
    setMissingField(null);
    const missingFields = [];

    if (!selectedTour) missingFields.push("tour");
    if (!isDateKey(bookingDate)) missingFields.push("date");
    if (bespoke && !departureIso) missingFields.push("time");
    if (bespoke && (!bespokeTotal.trim() || !Number.isFinite(Number(bespokeTotal)) || Number(bespokeTotal)<0 || totalAmount>99999999.99)) missingFields.push("amount");
    if (!bespoke && (!selectedSlot || !availableSlots.some(slot => slot.id === selectedSlotId))) missingFields.push("slot");
    if (!Number.isInteger(Number(adults)) || !Number.isInteger(Number(children)) || Number(adults)<0 || Number(children)<0 || qty <= 0 || (bespoke ? qty>2147483647 : qty>50)) missingFields.push("pax");
    if (!customerName.trim()) missingFields.push("name");

    // International mobile validation
    const mobileTrimmed = mobile.trim();
    if (mobileTrimmed && (!/^\+(\d{1,3})/.test(mobileTrimmed) || !/^[0-9]{7,15}$/.test(normalizePhone(mobileTrimmed)))) {
      missingFields.push("mobile_format");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) missingFields.push("email");
    if (!bespoke && discountType === "manual" && !discountReason.trim()) missingFields.push("discount_reason");
    if(questionConfig.error){setResult(questionConfig.error);return;}
    const checkedQuestions=missingFields.includes("pax") ? {answers:{},errors:[]} : validateQuestionAnswers(customFieldDefinitions,customFieldValues,Math.max(1,qty));
    for(const error of checkedQuestions.errors)missingFields.push(`custom_${questionErrorKey(error.key,error.participant)}`);

    if (missingFields.length > 0) {
      setMissingField(missingFields[0]);
      setResult("Check the highlighted field before reviewing this booking.");
      // Always surface a toast so admins don't get a silent no-op when fields
      // are missing. Field-level highlighting still happens via missingField.
      const fieldLabels: Record<string, string> = {
        tour: "Tour",
        date: "Date",
        slot: "Time slot",
        time: "Departure time",
        amount: "Total price",
        pax: "Number of guests",
        name: "Customer name",
        mobile: "Mobile number",
        mobile_format: "Mobile number (needs country code)",
        email: "Email address",
        discount_reason: "Override reason",
      };
      const customLabel = (key: string) => {
        if (!key.startsWith("custom_")) return key;
        const def = customFieldDefinitions.find((f) => `custom_${f.key}` === key.split(":")[0]);
        return def?.label || key.replace("custom_", "");
      };
      const labels = missingFields.map((f) => fieldLabels[f] || customLabel(f));
      if (missingFields.includes("mobile_format")) {
        notify({
          title: "Invalid mobile format",
          message: "Include the phone's country code, e.g. +27 or +44.",
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

    if (!bespoke && selectedSlot && Math.max(Number(selectedSlot.available_capacity || 0), 0) < qty) {
      setSubmitting(false);
      notify({
        title: "Slot no longer available",
        message: "Not enough places left. Choose another departure.",
        tone: "warning",
      });
      return;
    }

    if (!reviewing) { setReviewing(true); setResult(""); return; }
    submittingRef.current = true;
    setSubmitting(true);
    setResult("");
    try {
      const bookingId = requestIdRef.current ||= crypto.randomUUID();
      setAttemptedBookingId(bookingId);
      const payload = {
        tour_id: selectedTourId, slot_id: bespoke ? null : selectedSlotId,
        ...(bespoke ? { departure_override: true, departure_local: `${bookingDate}T${departureTime}:00` } : {}),
        customer_name: customerName.trim(), phone: normalizePhone(mobile) || null, email: email.trim().toLowerCase() || null,
        adults: Number(adults), children: Number(children), status, hold_hours: Number(holdHours),
        discount_type: bespoke ? "manual" : discountType, override_total: bespoke ? Number(bespokeTotal) : discountNum, discount_reason: bespoke ? (isExtraPax ? "Extra pax" : "Admin departure override") : discountReason.trim(),
        promo_code: !bespoke && discountType === "promo" ? promoResult?.code : null,
        add_ons: selectedAddOns, custom_fields: captureQuestionFields(customFieldDefinitions,checkedQuestions.answers,businessId,selectedTourId), expected_total: Math.round(totalAmount * 100) / 100,
        send_notifications: sendNotifications,
      };
      const { data: createdBooking, error: saveError } = await supabase.rpc("create_operator_booking", {
        p_business_id: businessId, p_request_id: bookingId, p_payload: payload,
      });
      if (saveError || !createdBooking?.ok) {
        setResult(saveError?.message || "Save unconfirmed. Retry here using the same reference to avoid a duplicate.");
        return;
      }
      if (createdBooking.replay) {
        notify({ title: "Booking recovered", message: "No messages repeated. Check delivery in booking history.", tone: "success" });
        openCreatedBooking(createdBooking);
        return;
      }
      const ref = createdBooking.id.substring(0, 8).toUpperCase();
      const slotObj = { start_time: createdBooking.start_time };
      const tourObj = selectedTour;
      const slotTimeLabel = slotObj?.start_time
        ? new Date(slotObj.start_time).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() })
        : "TBC";
      const tourDateLabel = slotObj?.start_time
        ? new Date(slotObj.start_time).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: getAdminTimezone() })
        : "TBC";
      // Tenant's real meeting point: per-tour first, business profile fallback.
      // Empty → the meeting-point block is omitted from messages entirely.
      const meetingPoint = String(tourObj?.meeting_point || bizMeetingPoint || "").trim();
      const mapsUrl = meetingPoint ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(meetingPoint) : "";

      const invoiceNumber = createdBooking.invoice_number || "";
      // ── Auto-send payment link for PENDING bookings ──
      let paymentLinkSent = false;
      if (sendNotifications && status === "PENDING" && email.trim() && totalAmount > 0) {
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
              if (errBody?.reason) checkoutErrDetail += ": " + errBody.reason;
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
                console.error("Payment link email failed");
                Sentry.captureException(new Error("Payment link email failed: " + detail), {
                  extra: { booking_id: createdBooking.id, ref, stage: "payment_email" },
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
                      "Payment due: " + new Intl.DateTimeFormat("en-ZA", {dateStyle:"full",timeStyle:"short",timeZone:timezone}).format(new Date(createdBooking.payment_deadline)) + " (" + timezone + ").",
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
      if (sendNotifications && (status === "PAID" || status === "CONFIRMED")) {
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
              console.error("Confirmation email failed");
              Sentry.captureException(new Error("Confirmation email failed: " + detail), {
                extra: { booking_id: createdBooking.id, ref, stage: "confirmation_email" },
              });
              notify({ title: "Confirmation email failed", message: "Error: " + detail + ". Resend from bookings page.", tone: "error", duration: 8000 });
            }
          } catch (e) {
            console.error("Confirmation email failed:", e);
            Sentry.captureException(e, { extra: { booking_id: createdBooking.id, ref, stage: "confirmation_email" } });
            notify({ title: "Confirmation email failed", message: "Could not send confirmation email. Resend from bookings page.", tone: "error", duration: 8000 });
          }

          // Send invoice email with pro forma PDF attachment
          if (invoiceNumber) try {
            const invoiceRes = await supabase.functions.invoke("send-email", {
              body: {
                type: "INVOICE",
                data: {
                  booking_id: createdBooking.id,
                  business_id: businessId,
                  email: email.trim().toLowerCase(),
                  customer_name: customerName.trim(),
                  customer_email: email.trim().toLowerCase(),
                  invoice_number: invoiceNumber,
                  invoice_date: new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: getAdminTimezone() }),
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
              console.error("Invoice email failed");
              Sentry.captureException(new Error("Invoice email failed: " + detail), {
                extra: { booking_id: createdBooking.id, ref, stage: "invoice_email" },
              });
            }
          } catch (e) {
            console.error("Invoice email failed:", e);
            Sentry.captureException(e, { extra: { booking_id: createdBooking.id, ref, invoice_number: invoiceNumber, stage: "invoice_email" } });
          }
        }

        // Email is the canonical confirmation; WhatsApp only when no email on file.
        if (mobile.trim() && !email.trim()) {
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
                  (meetingPoint
                    ? "\u{1F4CD} *Meeting Point:*\n" + meetingPoint + "\nArrive 15 min early\n\n" +
                      "\u{1F5FA} " + mapsUrl + "\n\n"
                    : "") +
                  "We can\u2019t wait to see you! \u{1F30A}",
              },
            });
          } catch (e) {
            console.error("WhatsApp confirmation failed:", e);
          }
        }
      }

      notify({
        title: "Booking created",
        message: !email.trim() && !mobile.trim() ? `Ref ${ref}. Add contact details in the booking to send guest messages.` : !sendNotifications || status === "HELD" ? `Ref ${ref}. No immediate guest message requested.` : status === "PENDING" && paymentLinkSent
          ? `Ref ${ref}. Payment link emailed to ${email.trim().toLowerCase()}.`
          : status === "PENDING"
            ? `Ref ${ref}. Payment link could not be sent; re-send it from the bookings page.`
            : `Ref ${ref}.`,
        tone: "success",
        duration: 7000,
      });
      openCreatedBooking(createdBooking);

    } catch (err: unknown) {
      setResult("Save unconfirmed. Retry here or check the booking reference before creating another.");
      notify({ title: "Booking creation failed", message: formatCaughtError(err), tone: "error" });
    } finally { submittingRef.current = false; setSubmitting(false); }
  }

  if (bookingCreated) return <p role="status">Opening Bookings…</p>;

  return (
    <div className={`${styles.form} max-w-5xl space-y-6`}>
      <div className="anim-fade-up flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={`${styles.pageTitle} font-display`} style={{ color: "var(--ck-text-strong)" }}>{returnTo === "/bookings" ? "New Booking" : "Add walk-in"}</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--ck-text-muted)" }}>{timezone}</p>
        </div>
        {returnTo !== "/bookings" && <button type="button" aria-label="Close Add walk-in" onClick={() => router.push(returnTo)} disabled={submitting} className="ui-btn ui-btn-ghost !h-11 !w-11 shrink-0 !p-0 disabled:opacity-50"><X size={20} aria-hidden="true" /></button>}
      </div>

      <div className="ui-card anim-fade-up anim-d1 p-5">
        <h3 className={`${styles.sectionTitle} mb-4`} style={{ color: "var(--ck-text-strong)" }}>1. Departure and party</h3>
        {canOverride && !isExtraPax && <label className="mb-4 flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={overrideDeparture} onChange={event=>{
            setOverrideDeparture(event.target.checked);setReviewing(false);setMissingField(null);
            slotRequestRef.current++;previewRequestRef.current++;
            if(event.target.checked){setStatus("CONFIRMED");if(selectedSlot)setDepartureTime(fmtTime(selectedSlot.start_time));}
          }} />Override departure and capacity
        </label>}
        {/* The calendar is the thing being read here, so it gets the room. The
            three selectors stack in a narrow column beside it rather than
            spreading across the full width above it. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
          {/* Left: tour + pax selectors, stacked */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <div>
              <label className="text-sm font-semibold text-[var(--ck-text)] flex items-center gap-1.5">
                Activity <span className="text-[var(--ck-danger)]">*</span>
              </label>
              <BookingSelect
                label="Activity"
                required
                disabled={loadingTours || !contextReady}
                placeholder="Choose an activity"
                value={selectedTourId}
                options={[...tours.map((t) => ({ id: t.id, name: t.name })), ...(canOverride ? [{id:EXTRA_PAX,name:"Extra pax"}] : [])]}
                onChange={(id) => { slotRequestRef.current++; previewRequestRef.current++; setSlots([]); setAvailabilityPreviewSlots([]); setSelectedSlotId(""); prefillRef.current.slotId=""; setSelectedTourId(id); if(id===EXTRA_PAX){setStatus("CONFIRMED");setReviewing(false);} setMissingField(null); }}
                error={missingField === "tour"}
              />
            </div>

            <CustomNumberInput
              label="Adults"
              unlimited={bespoke}
              value={adults}
              onChange={(v) => { setAdults(v); setMissingField(null); }}
              error={missingField === "pax"}
            />

            <CustomNumberInput
              label="Children"
              unlimited={bespoke}
              value={children}
              onChange={(v) => { setChildren(v); setMissingField(null); }}
            />
          </div>

          {/* Right: availability calendar */}
          {bespoke ? <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Departure date
              <input aria-label="Departure date" type="date" value={bookingDate} onChange={event=>{setBookingDate(event.target.value);setMissingField(null);setReviewing(false);}} aria-invalid={missingField==="date" || undefined} className="ui-control mt-1.5 w-full min-w-0" />
            </label>
            <label className="text-sm font-semibold">Departure time
              <input aria-label="Departure time" type="time" value={departureTime} onChange={event=>{setDepartureTime(event.target.value);setMissingField(null);setReviewing(false);}} aria-invalid={missingField==="time" || undefined} className="ui-control mt-1.5 w-full min-w-0" />
            </label>
            <label className="text-sm font-semibold sm:col-span-2">Total price (R)
              <input type="number" min="0" step="0.01" value={bespokeTotal} onChange={event=>{setBespokeTotal(event.target.value);setMissingField(null);setReviewing(false);}} aria-invalid={missingField==="amount" || undefined} className="ui-control mt-1.5 w-full" />
            </label>
          </div> : <div className="flex w-full min-w-0 flex-col">
            <label htmlFor="booking-date" className={`text-sm mb-1 self-start ${missingField === "date" ? "text-[var(--ck-danger)] font-medium" : "text-gray-600"}`}>Select date <span className="text-[var(--ck-danger)]">*</span></label>
            <input id="booking-date" type="date" aria-label="Departure date" value={bookingDate}
              onChange={event => { setBookingDate(event.target.value); setMatrixStartDate(event.target.value); setMissingField(null); }}
              aria-invalid={missingField === "date" || undefined} className={`ui-control ${styles.dateInput}`} />
            <div className={`${styles.calendar} w-full overflow-x-auto rounded-xl transition-colors ${missingField === "date" ? "ring-2 ring-[var(--ck-danger)]" : ""}`}>
              <AvailabilityCalendar
                value={bookingDate}
                onChange={(v) => { setBookingDate(v); setMatrixStartDate(v); setMissingField(null); }}
                tourId={selectedTourId}
                businessId={businessId}
                minQty={qty}
              />
            </div>

            {!loadingSlots && availableSlots.length===0 && !dataError && <p role="status" className="mb-3 text-sm">Insufficient capacity</p>}
            <div className="mt-4">
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--ck-text)" }}>
                Departure time <span style={{ color: "var(--ck-danger)" }}>*</span>
              </label>
              <BookingSelect
                label="Departure time"
                required
                placeholder={loadingSlots ? "Loading departures…" : availableSlots.length > 0 ? "Choose departure time" : "No departures available"}
                disabled={loadingSlots || !contextReady}
                value={selectedSlotId}
                options={availableSlots.map((slot) => {
                  const available = Math.max(Number(slot.available_capacity || 0), 0);
                  return {
                    id: slot.id,
                    name: `${fmtTime(slot.start_time)} · ${available} ${available === 1 ? "place" : "places"} available`,
                  };
                })}
                onChange={(id) => { setSelectedSlotId(id); setMissingField(null); }}
                error={missingField === "slot"}
              />
            </div>

          </div>}
        </div>

        {!bespoke && <details className="mt-6 border-t pt-3" style={{ borderColor: "var(--ck-border-subtle)" }}>
          <summary className="min-h-12 cursor-pointer py-3 text-base font-semibold">Compare nearby dates</summary>
          {loadingAvailabilityPreview ? (
            <div className="ui-skeleton h-24" aria-label="Loading nearby departures" />
          ) : availabilityTimeRows.length === 0 ? (
            <p className="py-3 text-sm" role="status">No departures in the next five days. Choose another date or activity.</p>
          ) : (
            <div className={styles.comparison}>
              {availabilityDays.map((day, dayIndex) => {
                const times = availabilityTimeRows.map(row => ({ time: row.time, ...row.days[dayIndex] })).filter(cell => cell.slotId);
                return <section key={day} className={styles.day} aria-label={`${formatWeekdayLabel(day)}, ${formatDayLabel(day)}`}>
                  <h4 className="mb-3 text-base font-semibold">{formatWeekdayLabel(day)} <span className="block text-sm font-normal" style={{ color: "var(--ck-text-muted)" }}>{formatDayLabel(day)}</span></h4>
                  <div className="grid gap-2">
                    {times.length === 0 ? <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>No departures</p> : times.map(cell => {
                      const selected = selectedSlotId === cell.slotId && bookingDate === cell.day;
                      return <button key={cell.slotId} type="button" disabled={!cell.isAvailable} aria-pressed={selected}
                        aria-label={`${cell.day} ${cell.time}, ${cell.available} places available`}
                        onClick={() => {
                          if (!cell.slotId) return;
                          setPendingMatrixSelection({ day: cell.day, slotId: cell.slotId });
                          setBookingDate(cell.day);
                          setSelectedSlotId(cell.slotId);
                          setMissingField(null);
                        }}
                        className={styles.timeButton}>
                        <span className="font-semibold tabular-nums">{cell.time}</span>
                        <span className="text-sm">{cell.available === 0 ? "Full" : cell.isAvailable ? `${cell.available} open` : `Need ${qty} places`}</span>
                        {selected && <Check size={16} aria-hidden="true" className="shrink-0" />}
                      </button>;
                    })}
                  </div>
                </section>;
              })}
            </div>
          )}
        </details>}

        {questionConfig.error && <p role="alert" className="mt-4">{questionConfig.error}</p>}
        {customFieldDefinitions.length > 0 && (
          <div className="mt-6 border-t border-gray-100 pt-6">
            <h4 className="text-sm font-semibold text-[var(--ck-text)]">Additional Booking Details</h4>
            <BookingQuestions questions={customFieldDefinitions} answers={customFieldValues} qty={qty} invalidKey={missingField} onChange={values=>{setCustomFieldValues(values);setMissingField(null);}}/>
          </div>
        )}
      </div>

      <div className="ui-card p-5">
        <h3 className={`${styles.sectionTitle} mb-4`} style={{ color: "var(--ck-text-strong)" }}>2. Guest and contact details</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="text-sm" style={{ color: "var(--ck-text)" }}>
            Full Name <span style={{ color: "var(--ck-danger)" }}>*</span>
            <input
              value={customerName}
              aria-required="true"
              onChange={(e) => { setCustomerName(e.target.value); setMissingField(null); }}
              autoComplete="off"
              className={"ui-control mt-1 w-full" + (missingField === "name" ? " !border-[var(--ck-danger)]" : "")}
            />
          </label>
          <label className="text-sm" style={{ color: "var(--ck-text)" }}>
            Mobile Number <span style={{ color: "var(--ck-text-muted)" }}>(optional)</span>
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
              required
              aria-required="true"
              aria-invalid={missingField === "email"}
              aria-describedby={missingField === "email" ? "booking-email-error" : undefined}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setMissingField(null); }}
              autoComplete="off"
              className={"ui-control mt-1 w-full" + (missingField === "email" ? " !border-[var(--ck-danger)]" : "")}
            />
            {missingField === "email" && <p id="booking-email-error" className="mt-1 text-xs" style={{ color: "var(--ck-danger)" }}>Enter a valid email address for payment notices and the waiver.</p>}
          </label>
        </div>
      </div>

      <div className="ui-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className={styles.sectionTitle} style={{ color: "var(--ck-text-strong)" }}>Booking total</h3>
          <p className="ui-mono-label">
            {bespoke ? "Admin override" : loadingSlots ? "Loading departures…" : `${availableSlots.length} ${availableSlots.length === 1 ? "departure" : "departures"} · ${availableSeats} ${availableSeats === 1 ? "place" : "places"} available`}
          </p>
        </div>


        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-6">
          <div className="rounded-lg p-3 text-sm sm:col-span-2" style={{ background: "var(--ck-surface-sunken)" }}>
            <p className={styles.fieldLabel}>Guests</p>
            <p className="font-display mt-1 text-xl font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{qty}</p>
          </div>
          <div className="rounded-lg p-3 text-sm sm:col-span-2" style={{ background: "var(--ck-surface-sunken)" }}>
            <p className={styles.fieldLabel}>{bespoke ? "Total price" : "Price per guest"}</p>
            <p className="font-display mt-1 text-xl font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{priceUnavailable?"Price unavailable":fmtCurrency(bespoke ? baseTotal : unitPrice)}</p>
          </div>
          <div className="rounded-lg p-3 text-sm sm:col-span-2" style={{ background: "var(--ck-surface-sunken)" }}>
            <p className={styles.fieldLabel}>{bespoke ? "With extras" : "Activity total"}</p>
            <p className="font-display mt-1 text-xl font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{priceUnavailable?"Price unavailable":fmtCurrency(bespoke ? totalAmount : baseTotal)}</p>
          </div>
          <div className={`rounded-lg p-3 text-sm ${["PENDING", "HELD", "CONFIRMED"].includes(status) ? "sm:col-span-4" : "sm:col-span-6"}`} style={{ background: "var(--ck-surface-sunken)" }}>
            <label htmlFor="booking-payment-action" className={styles.fieldLabel}>Payment action</label>
            <BookingSelect label="Payment action" id="booking-payment-action" value={status} onChange={setStatus}
              options={PAYMENT_ACTIONS.filter(action => !bespoke || action.id === "CONFIRMED" || action.id === "PAID")} />
          </div>
          {["PENDING", "HELD", "CONFIRMED"].includes(status) && (
            <div className="rounded-lg p-3 text-sm sm:col-span-2" style={{ background: "var(--ck-surface-sunken)" }}>
              <label htmlFor="booking-payment-due" className={styles.fieldLabel}>Payment due within</label>
              <BookingSelect label="Payment due within" id="booking-payment-due" value={holdHours} onChange={setHoldHours}
                options={[{id:"2",name:"2 hours"},{id:"6",name:"6 hours"},{id:"12",name:"12 hours"},{id:"24",name:"24 hours"},
                  {id:"48",name:"2 days"},{id:"72",name:"3 days"},{id:"168",name:"7 days"}]} />
            </div>
          )}
        </div>
      </div>

      {/* Optional Add-Ons */}
      {availableAddOns.length > 0 && (
        <div className="ui-card p-5">
          <h3 className={`${styles.sectionTitle} mb-4`} style={{ color: "var(--ck-text-strong)" }}>3. Optional extras</h3>
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
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-base font-bold disabled:opacity-30"
                      style={{ background: "var(--ck-surface)", border: "1px solid var(--ck-border-strong)", color: "var(--ck-text)" }}
                    >-</button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{aoQty}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedAddOns(prev => ({ ...prev, [ao.id]: (prev[ao.id] || 0) + 1 }))}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-base font-bold"
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
      {!bespoke && <details className="ui-card p-5">
        <summary className="cursor-pointer font-semibold">Discount or price override</summary>
        <h3 className={`${styles.sectionTitle} mb-4`} style={{ color: "var(--ck-text-strong)" }}>Price Adjustment</h3>

        <p className="mb-3 text-sm">Price overrides require a reason.</p>
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
                p_order_amount: grandTotal,
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
            <span>{promoResult.discount_type === "PERCENT" ? promoResult.discount_value + "% off" : "R" + promoResult.discount_value + " off"}</span>
            <button type="button" onClick={() => { setDiscountType("none"); setPromoCode(""); setPromoResult(null); }} className="ml-auto text-xs hover:underline" style={{ color: "var(--ck-danger)" }}>Remove</button>
          </div>
        )}

        <label className="flex items-center gap-3 cursor-pointer select-none mb-4">
          <input
            type="checkbox"
            checked={discountType === "manual"}
            disabled={!["ADMIN","MAIN_ADMIN","SUPER_ADMIN"].includes(role)}
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
      </details>}
      {priceUnavailable && <p className="ui-card p-4" role="alert">Price unavailable. Ask an admin to check it before booking.</p>}
      {blockingDataError && <div className="ui-card p-4" role="alert">{blockingDataError} <button type="button" className="underline" onClick={() => { setDataError(""); loadTours(); loadBusinessSettings(); loadAddOns(); loadSlots(); loadAvailabilityPreview(); }}>Refresh booking data</button></div>}
      {attemptedBookingId && !bookingCreated && <p className="text-sm">Save reference: <Link className="underline" href={`/bookings/${attemptedBookingId}`}>{attemptedBookingId.slice(0,8).toUpperCase()}</Link>. If saving fails, retry here or check this reference before creating another booking.</p>}
      {result && <p ref={resultFocusRef} tabIndex={-1} role="alert" className="text-[var(--ck-danger)]">{result}</p>}
      {reviewing && <section ref={reviewFocusRef} tabIndex={-1} className={`${styles.review} ui-card`} aria-label="Review booking">
        <div className={styles.reviewHeader}>
          <h3 className={styles.sectionTitle}>4. Review booking</h3>
          <button type="button" className="ui-btn ui-btn-soft" onClick={() => setReviewing(false)}>Edit booking</button>
        </div>
        <div className={styles.reviewOverview}>
          <div className={styles.reviewBooking}>
            <h4 className={styles.reviewActivity}>{selectedTour?.name}</h4>
            <dl className={styles.reviewFacts}>
              <div className={styles.reviewDeparture}>
                <dt>Departure</dt>
                <dd>{(bespoke ? departureIso : selectedSlot?.start_time) ? new Intl.DateTimeFormat("en-ZA",{dateStyle:"full",timeStyle:"short",timeZone:timezone}).format(new Date(bespoke ? departureIso : selectedSlot!.start_time)) : "Choose a valid departure"}<span className={styles.reviewSecondary}>{timezone}</span></dd>
              </div>
              <div><dt>Lead guest</dt><dd>{customerName}</dd></div>
              <div><dt>Group size</dt><dd>{qty} {qty === 1 ? "guest" : "guests"}<span className={styles.reviewSecondary}>{adults || 0} {Number(adults)===1?"adult":"adults"}, {children || 0} {Number(children)===1?"child":"children"}</span></dd></div>
            </dl>
          </div>
          <div className={styles.reviewPricing}>
            <h4 className={styles.fieldLabel}>Price summary</h4>
            <dl className={styles.reviewAmounts}>
              <div><dt>Activity</dt><dd>{fmtCurrency(baseTotal)}</dd></div>
              <div><dt>Extras</dt><dd>{fmtCurrency(addOnsTotal)}</dd></div>
              {!bespoke && discountType === "manual" && <div><dt>Activity price override</dt><dd>{fmtCurrency(discountNum)}</dd></div>}
              {!bespoke && discountType === "promo" && promoResult?.valid && <div><dt>Promo discount</dt><dd>−{fmtCurrency(promoDiscountCalc)}</dd></div>}
              <div className={styles.reviewTotal}><dt>Final total</dt><dd>{fmtCurrency(totalAmount)}</dd></div>
            </dl>
          </div>
        </div>
        <div className={styles.reviewPayment}>
          <h4 className={styles.fieldLabel}>Payment action</h4>
          <p>{PAYMENT_ACTIONS.find(action => action.id === status)?.name}</p>
        </div>
        {customFieldDefinitions.length>0 && <details className={styles.reviewDetails}><summary>Participant details</summary><dl className="mt-2 space-y-2 text-sm">{bookingCustomFieldEntries(captureQuestionFields(customFieldDefinitions,validateQuestionAnswers(customFieldDefinitions,customFieldValues,qty).answers,businessId,selectedTourId)).map(field=><div key={field.key}><dt className="font-medium">{field.label}</dt><dd className="whitespace-pre-wrap break-words">{field.value}</dd></div>)}</dl></details>}
        {bespoke && <p>Admin override: {qty} places at your chosen time and price. This booking will appear in the manifest.</p>}
        {!bespoke && discountType === "manual" && <p>Admin price override: {discountReason}. Saved with your admin identity and price change.</p>}
        {status !== "HELD" && (email.trim() || mobile.trim()) && <label className={styles.reviewNotification}><input type="checkbox" checked={sendNotifications} onChange={event => setSendNotifications(event.target.checked)} /><span><strong>Send guest messages</strong><span className={styles.reviewSecondary}>Send the {status === "PENDING" ? "payment request by email and WhatsApp, if configured" : "confirmation and invoice, where contact details allow"} to {[email.trim(), mobile.trim()].filter(Boolean).join(" and ")}.</span></span></label>}
        {!email.trim() && !mobile.trim() && <p className="text-sm">No contact details. Add them later to send guest messages.</p>}
      </section>}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <button data-demo-action="booking.create"
          onClick={createBooking}
          disabled={submitting || readOnly || !!blockingDataError || priceUnavailable || loadingTours || (!bespoke && loadingSlots)}
          className="ui-btn ui-btn-primary w-full !h-11 !px-5 disabled:opacity-50 sm:w-auto"
        >
          {submitting ? "Saving…" : reviewing ? `Create Booking · ${fmtCurrency(totalAmount)}` : "Review booking"}
        </button>
        <button type="button" onClick={() => router.push(returnTo)} disabled={submitting} className="ui-btn ui-btn-ghost !h-11 !px-5 disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
