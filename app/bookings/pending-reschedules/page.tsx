"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { useBusinessContext } from "../../../components/BusinessContext";
import { notify } from "../../lib/app-notify";
import { getAdminTimezone } from "../../lib/admin-timezone";

type PendingRow = {
  id: string;
  booking_id: string;
  diff: number;
  new_total_amount: number;
  created_at: string;
  booking: { customer_name: string | null; email: string | null; phone: string | null; total_amount: number | null } | null;
  new_slot: { start_time: string } | null;
  new_tour: { name: string } | null;
  hold: { expires_at: string | null; status: string | null } | null;
};

export default function PendingReschedulesPage() {
  const { businessId } = useBusinessContext();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);

  async function load() {
    if (!businessId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("pending_reschedules")
      .select(
        "id, booking_id, diff, new_total_amount, created_at, " +
          "booking:booking_id(customer_name, email, phone, total_amount), " +
          "new_slot:new_slot_id(start_time), " +
          "new_tour:new_tour_id(name), " +
          "hold:hold_id(expires_at, status)",
      )
      .eq("business_id", businessId)
      .eq("status", "PENDING")
      .order("created_at", { ascending: false });
    if (error) {
      notify({ title: "Load failed", message: error.message, tone: "error" });
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as PendingRow[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [businessId]);

  async function resend(row: PendingRow) {
    if (!row.booking?.email) {
      notify({ title: "Missing email", message: "No email on the underlying booking.", tone: "warning" });
      return;
    }
    setResending(row.id);
    try {
      const res = await supabase.functions.invoke("create-checkout", {
        body: {
          amount: Number(row.diff || 0),
          booking_id: row.booking_id,
          business_id: businessId,
          type: "RESCHEDULE",
          pending_reschedule_id: row.id,
        },
      });
      if (res.error) {
        notify({ title: "Re-send failed", message: res.error.message, tone: "error" });
      } else if (res.data?.redirectUrl) {
        notify({ title: "Payment link re-sent", message: "Customer notified via email + WhatsApp.", tone: "success" });
        load();
      } else {
        notify({ title: "Re-send failed", message: "No redirect URL returned.", tone: "error" });
      }
    } catch (err: unknown) {
      notify({ title: "Re-send failed", message: err instanceof Error ? err.message : String(err), tone: "error" });
    }
    setResending(null);
  }

  const tz = getAdminTimezone();
  const fmtSlot = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }) : "—";

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Pending Reschedules</h1>
        <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-800 font-medium">
          {rows.length} awaiting payment
        </span>
      </div>

      <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
        Reschedules with an upgrade fee that haven&rsquo;t been paid yet. The new slot is held for 15&nbsp;min from
        the time the link was issued; if the hold lapses the original booking stays put. Use <strong>Re-send link</strong>
        {" "}to issue a fresh checkout (and notify the customer via email + WhatsApp).
      </p>

      {loading ? (
        <div className="flex items-center justify-center min-h-[20vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: "var(--ck-text-muted)" }}>
          No pending reschedules right now.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const exp = r.hold?.expires_at ? new Date(r.hold.expires_at).getTime() : 0;
            const minsLeft = exp ? Math.max(0, Math.round((exp - now) / 60000)) : null;
            const holdExpired = minsLeft !== null && minsLeft <= 0;
            const customerLabel = r.booking?.customer_name || r.booking?.email || "Customer";
            return (
              <div
                key={r.id}
                className="p-4 rounded-xl border"
                style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>{customerLabel}</span>
                      <Link href={`/bookings/${r.booking_id}`} className="text-xs underline" style={{ color: "var(--ck-text-muted)" }}>
                        booking
                      </Link>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${holdExpired ? "bg-gray-100 text-gray-600" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
                        {holdExpired ? "hold expired" : minsLeft !== null ? `hold ${minsLeft}m left` : "no hold"}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">+R{Number(r.diff || 0).toFixed(0)}</span>
                    </div>
                    <div className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                      Held {new Date(r.created_at).toLocaleString("en-ZA")}
                      {r.booking?.email && <> · {r.booking.email}</>}
                      {r.booking?.phone && <> · {r.booking.phone}</>}
                    </div>
                    <div className="mt-1 text-xs" style={{ color: "var(--ck-text)" }}>
                      → {r.new_tour?.name || "Tour"} · {fmtSlot(r.new_slot?.start_time)}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <button
                      onClick={() => resend(r)}
                      disabled={resending === r.id}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {resending === r.id ? "Sending…" : "Re-send link"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
