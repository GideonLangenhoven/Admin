"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { useBusinessContext } from "../../components/BusinessContext";
import { isComboEnabledClient } from "../lib/feature-flags";
import { evenPercentSplit } from "../lib/combo-splits";

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: getAdminTimezone() });
}

// Per-offer rules. The policy sets the FORM of compensation on cancel; each
// leg's own refund tiers still set the amount. Gap rules and ordering are
// enforced at checkout server-side, this form only captures them.
const DEFAULT_RULES = { policy: "VOUCHER_ONLY", min: "", max: "", order: false };
type RuleDraft = typeof DEFAULT_RULES;

const POLICY_SHORT: Record<string, string> = {
  VOUCHER_ONLY: "Voucher-only",
  NO_CANCEL: "Non-cancellable",
  POLICY_REFUND: "Cash per refund policy",
};

function draftFromOffer(o: any): RuleDraft {
  const r = o.combo_rules || {};
  return {
    policy: o.cancellation_policy || "VOUCHER_ONLY",
    min: r.min_gap_days != null ? String(r.min_gap_days) : "",
    max: r.max_gap_days != null ? String(r.max_gap_days) : "", // 0 is valid (same day)
    order: Boolean(r.enforce_order),
  };
}

function rulesBody(d: RuleDraft) {
  return {
    cancellation_policy: d.policy,
    combo_rules: {
      ...(d.min ? { min_gap_days: Number(d.min) } : {}),
      ...(d.max ? { max_gap_days: Number(d.max) } : {}),
      ...(d.order ? { enforce_order: true } : {}),
    },
  };
}

function gapError(d: RuleDraft) {
  return d.min && d.max && Number(d.min) > Number(d.max)
    ? "The minimum gap cannot be larger than the maximum gap."
    : "";
}

function rulesSummary(o: any) {
  const r = o.combo_rules || {};
  const parts = [POLICY_SHORT[o.cancellation_policy] || POLICY_SHORT.VOUCHER_ONLY];
  if (r.min_gap_days != null) parts.push(r.min_gap_days + "+ days apart");
  if (r.max_gap_days != null) parts.push(r.max_gap_days === 0 ? "same day" : "within " + r.max_gap_days + " days");
  if (r.enforce_order) parts.push("in order");
  return parts.join(" · ");
}

function RuleFields({ value, onChange }: { value: RuleDraft; onChange: (patch: Partial<RuleDraft>) => void }) {
  const err = gapError(value);
  return (
    <div className="space-y-2">
      <p className="ui-mono-label !text-[10px]">Package rules</p>
      <label className="block space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
        If a customer cancels
        <select className="ui-control w-full text-sm" value={value.policy} onChange={(e) => onChange({ policy: e.target.value })}>
          <option value="VOUCHER_ONLY">Voucher only (default): cancellations become a credit voucher</option>
          <option value="NO_CANCEL">Non-cancellable: no customer self-service cancellation</option>
          <option value="POLICY_REFUND">Cash per refund policy: cash refund at each operator&rsquo;s own tiers</option>
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
          Minimum days between tours
          <input className="ui-control w-full text-sm" type="number" min="1" placeholder="No rule" value={value.min} onChange={(e) => onChange({ min: e.target.value })} />
        </label>
        <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
          Maximum days between tours
          <input className="ui-control w-full text-sm" type="number" min="0" placeholder="No rule" value={value.max} onChange={(e) => onChange({ max: e.target.value })} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
        <input type="checkbox" checked={value.order} onChange={(e) => onChange({ order: e.target.checked })} />
        Tours must be taken in order
      </label>
      {err && <p className="text-[12px]" style={{ color: "var(--ck-danger)" }}>{err}</p>}
    </div>
  );
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }
    : { "Content-Type": "application/json" };
}

export default function PartnershipsPage() {
  const { businessId, role } = useBusinessContext();
  const comboEnabled = isComboEnabledClient();

  const [loading, setLoading] = useState(true);
  const [partnerships, setPartnerships] = useState<any[]>([]);
  const [offers, setOffers] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[] | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  // Offer create form — row 0 is always one of my tours; further rows are
  // partner tours (2–10 legs, so a combo can span several operators).
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [myTours, setMyTours] = useState<any[]>([]);
  const [partnerToursCache, setPartnerToursCache] = useState<Record<string, any[]>>({});
  const [offerRows, setOfferRows] = useState<Array<{ partner_id: string; tour_id: string; share: string }>>([
    { partner_id: "", tour_id: "", share: "50" },
    { partner_id: "", tour_id: "", share: "50" },
  ]);
  const [offerName, setOfferName] = useState("");
  const [comboPrice, setComboPrice] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [splitType, setSplitType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [savingOffer, setSavingOffer] = useState(false);
  const [newRules, setNewRules] = useState<RuleDraft>(DEFAULT_RULES);

  // Per-offer rules editor: which row is open, and its draft.
  const [rulesFor, setRulesFor] = useState<string | null>(null);
  const [rulesDraft, setRulesDraft] = useState<RuleDraft>(DEFAULT_RULES);

  // Settlement notes per partner
  const [settleNotes, setSettleNotes] = useState<Record<string, string>>({});
  const [settling, setSettling] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    const headers = await authHeaders();
    const [pRes, oRes, sRes] = await Promise.all([
      fetch(`/api/partnerships?business_id=${businessId}`, { headers }),
      fetch(`/api/combo-offers?business_id=${businessId}`, { headers }),
      fetch(`/api/combo-settlements?business_id=${businessId}`, { headers }),
    ]);
    const p = await pRes.json().catch(() => ({}));
    const o = await oRes.json().catch(() => ({}));
    setPartnerships(p.partnerships || []);
    setOffers(o.combo_offers || []);
    if (sRes.ok) {
      const s = await sRes.json().catch(() => ({}));
      setSettlements(s.settlements || []);
    } else {
      setSettlements(null); // 503 = combo feature flag off server-side
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  // Load tour lists when the offer-form partner changes
  useEffect(() => {
    if (!showOfferForm || !businessId) return;
    (async () => {
      const { data } = await supabase.from("tours").select("id, name, base_price_per_person").eq("business_id", businessId).eq("active", true).order("sort_order");
      setMyTours(data || []);
    })();
  }, [showOfferForm, businessId]);

  async function loadPartnerTours(partnerId: string) {
    if (!partnerId || partnerToursCache[partnerId]) return;
    const headers = await authHeaders();
    const r = await fetch(`/api/partner-tours?partner_id=${partnerId}`, { headers });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { notify({ title: "Could not load partner tours", message: d.error || "", tone: "error" }); return; }
    setPartnerToursCache((c) => ({ ...c, [partnerId]: d.tours || [] }));
  }

  function updateOfferRow(idx: number, patch: Partial<{ partner_id: string; tour_id: string; share: string }>) {
    setOfferRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function invitePartner() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    const headers = await authHeaders();
    const r = await fetch("/api/partnerships", {
      method: "POST", headers,
      body: JSON.stringify({ action: "invite", business_id: businessId, partner_email: inviteEmail.trim() }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) {
      notify({ title: "Invite failed", message: d.error || "Unknown error", tone: "error" });
    } else {
      notify({ title: "Invite sent", message: "Your partner will receive an email with an approval link.", tone: "success" });
      setInviteEmail("");
      load();
    }
    setInviting(false);
  }

  async function partnershipAction(action: "accept" | "revoke", partnershipId: string) {
    setBusy(partnershipId);
    const headers = await authHeaders();
    const r = await fetch("/api/partnerships", {
      method: "POST", headers,
      body: JSON.stringify({ action, business_id: businessId, partnership_id: partnershipId }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) notify({ title: action === "accept" ? "Accept failed" : "Revoke failed", message: d.error || "Unknown error", tone: "error" });
    else {
      notify({ title: action === "accept" ? "Partnership active" : "Partnership revoked", message: action === "revoke" ? "All combo offers under it were deactivated." : "You can now create combo offers together.", tone: "success" });
      load();
    }
    setBusy(null);
  }

  async function createOffer() {
    const price = Number(comboPrice);
    if (!offerName.trim() || !price) {
      notify({ title: "Missing fields", message: "A name and a combo price are required.", tone: "error" });
      return;
    }
    if (offerRows.some((r, i) => !r.tour_id || (i > 0 && !r.partner_id))) {
      notify({ title: "Missing fields", message: "Every row needs an operator (except your own tour) and a tour.", tone: "error" });
      return;
    }
    if (gapError(newRules)) {
      notify({ title: "Invalid rules", message: gapError(newRules), tone: "error" });
      return;
    }
    // Single-operator combo (all legs are my own tours): no money moves between
    // operators, so shares are auto-distributed — nothing for the user to type.
    const effectiveSplitType = allMine ? "PERCENT" : splitType;
    const autoShares = allMine ? evenPercentSplit(offerRows.length) : null;
    const shares = autoShares ?? offerRows.map((r) => Number(r.share));
    if (!allMine) {
      if (shares.some((s) => !(s > 0))) {
        notify({ title: "Invalid split", message: "Every share must be greater than 0.", tone: "error" });
        return;
      }
      const shareSum = Math.round(shares.reduce((a, b) => a + b, 0) * 100) / 100;
      if (splitType === "PERCENT" && Math.abs(shareSum - 100) > 0.01) {
        notify({ title: "Invalid split", message: `Percentages must total 100% (currently ${shareSum}%).`, tone: "error" });
        return;
      }
      if (splitType === "FIXED" && Math.abs(shareSum - price) > 0.01) {
        notify({ title: "Invalid split", message: `Fixed shares must total the combo price of R${price} (currently R${shareSum}).`, tone: "error" });
        return;
      }
    }
    setSavingOffer(true);
    const headers = await authHeaders();
    const r = await fetch("/api/combo-offers", {
      method: "POST", headers,
      body: JSON.stringify({
        action: "create",
        business_id: businessId,
        name: offerName.trim(),
        combo_price: price,
        original_price: Number(originalPrice) || price,
        split_type: effectiveSplitType,
        ...rulesBody(newRules),
        items: offerRows.map((row, i) => ({
          business_id: row.partner_id && row.partner_id !== "__self" ? row.partner_id : businessId,
          tour_id: row.tour_id,
          split_percent: effectiveSplitType === "PERCENT" ? shares[i] : undefined,
          split_fixed: effectiveSplitType === "FIXED" ? shares[i] : undefined,
        })),
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) notify({ title: "Could not create offer", message: d.error || "Unknown error", tone: "error" });
    else {
      notify({ title: "Combo offer created", message: "It is live on your booking site's combo section.", tone: "success" });
      setShowOfferForm(false);
      setOfferName(""); setComboPrice(""); setOriginalPrice("");
      setOfferRows([{ partner_id: "", tour_id: "", share: "50" }, { partner_id: "", tour_id: "", share: "50" }]);
      setNewRules(DEFAULT_RULES);
      load();
    }
    setSavingOffer(false);
  }

  async function saveRules(offer: any) {
    if (gapError(rulesDraft)) {
      notify({ title: "Invalid rules", message: gapError(rulesDraft), tone: "error" });
      return;
    }
    setBusy(offer.id);
    const headers = await authHeaders();
    const r = await fetch("/api/combo-offers", {
      method: "POST", headers,
      body: JSON.stringify({ action: "update", business_id: businessId, combo_offer_id: offer.id, ...rulesBody(rulesDraft) }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) notify({ title: "Could not save rules", message: d.error || "Unknown error", tone: "error" });
    else {
      notify({ title: "Rules saved", message: "They apply to new bookings of this package.", tone: "success" });
      setRulesFor(null);
      load();
    }
    setBusy(null);
  }

  async function toggleOffer(offer: any) {
    setBusy(offer.id);
    const headers = await authHeaders();
    const r = await fetch("/api/combo-offers", {
      method: "POST", headers,
      body: JSON.stringify({ action: offer.active ? "deactivate" : "activate", business_id: businessId, combo_offer_id: offer.id }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) notify({ title: "Update failed", message: d.error || "Unknown error", tone: "error" });
    else load();
    setBusy(null);
  }

  async function markSettled(partner: any) {
    const ids = (partner.bookings || []).filter((b: any) => !b.settled).map((b: any) => b.id);
    if (ids.length === 0) return;
    setSettling(partner.partner_id);
    const headers = await authHeaders();
    const r = await fetch("/api/combo-settlements", {
      method: "POST", headers,
      body: JSON.stringify({ combo_booking_ids: ids, partner_business_id: partner.partner_id, notes: settleNotes[partner.partner_id] || null }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) notify({ title: "Settlement failed", message: d.error || "Unknown error", tone: "error" });
    else {
      notify({ title: "Marked settled", message: d.settled + " combo booking" + (d.settled === 1 ? "" : "s") + " recorded in the settlement register.", tone: "success" });
      setSettleNotes((n) => ({ ...n, [partner.partner_id]: "" }));
      load();
    }
    setSettling(null);
  }

  async function generatePaymentLink(partner: any) {
    setLinkBusy(partner.partner_id);
    const { data, error } = await supabase.functions.invoke("combo-settlement-link", {
      body: { partner_business_id: partner.partner_id },
    });
    let msg: string | undefined = error?.message || data?.error;
    if (error && (error as any).context?.json) {
      try { msg = (await (error as any).context.json())?.error || msg; } catch { /* keep generic */ }
    }
    if (error || data?.error) {
      notify({ title: "Could not create payment link", message: msg || "Unknown error", tone: "error" });
    } else {
      notify({
        title: data.reused ? "Payment link already active" : "Payment link created",
        message: data.email_sent
          ? "R" + Number(data.amount).toFixed(2) + " payment link emailed to your partner. It will flip to Paid automatically once they pay."
          : "Link created for R" + Number(data.amount).toFixed(2) + ". Your partner has no notification email on file — copy the link and send it to them.",
        tone: "success",
      });
      load();
    }
    setLinkBusy(null);
  }

  if (!/MAIN_ADMIN|SUPER_ADMIN/.test(role)) {
    return (
      <div className="ui-card"><div className="ui-empty">
        <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Admin access required</p>
        <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Partnerships and combo deals are managed by the main admin.</p>
      </div></div>
    );
  }

  if (loading) return <div className="space-y-4 py-2"><div className="ui-skeleton h-8 w-48" /><div className="ui-skeleton h-[160px] !rounded-2xl" /><div className="ui-skeleton h-[280px] !rounded-2xl" /></div>;

  const activePartners = partnerships.filter((p) => p.status === "ACTIVE");
  // Every leg mine? (Row 0 is always mine; later rows are mine when "__self".)
  const allMine = offerRows.every((r, i) => i === 0 || r.partner_id === "__self" || !r.partner_id);
  const splitLabel = (o: any) => {
    if (o.items?.length) {
      return o.items.map((i: any) => (i.businesses?.business_name || "?") + " " + (o.split_type === "PERCENT" ? Number(i.split_percent) + "%" : "R" + Number(i.split_fixed))).join(" · ");
    }
    return o.split_type === "PERCENT" ? `${Number(o.split_a_percent)}% / ${Number(o.split_b_percent)}%` : `R${Number(o.split_a_fixed)} / R${Number(o.split_b_fixed)}`;
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="anim-fade-up">
        <p className="ui-mono-label mb-2">Growth · Partners</p>
        <h2 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Partners &amp; Combos</h2>
        <p className="mt-2 text-[13px]" style={{ color: "var(--ck-text-muted)" }}>
          Team up with another operator, sell bundled tours, and track who owes whom.
        </p>
      </div>

      {!comboEnabled && (
        <div className="anim-fade-up ui-card p-4" style={{ borderColor: "var(--ck-warning, #d9822f)" }}>
          <p className="text-[13px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Combo deals are not switched on yet</p>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>
            You can set up partnerships and offers now; customers will see combo deals once the platform enables the feature.
          </p>
        </div>
      )}

      {/* ── Partnerships ── */}
      <section className="anim-fade-up anim-d1 ui-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Partnerships</h3>
          <span className="ui-mono-label !text-[10px]">{activePartners.length} active</span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="Partner operator's admin email"
            className="ui-control flex-1 text-sm"
          />
          <button onClick={invitePartner} disabled={inviting || !inviteEmail.trim()} className="ui-btn ui-btn-primary">
            {inviting ? "Sending…" : "Invite Partner"}
          </button>
        </div>
        <p className="text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
          They get an email with a one-click approval link. Once accepted, you can build combo offers together.
        </p>

        {partnerships.length === 0 ? (
          <div className="ui-empty">
            <p className="text-[13px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No partnerships yet</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Invite another BookingTours operator to get started.</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--ck-border)" }}>
            {partnerships.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{p.partner_name}</p>
                  <p className="text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                    {p.status === "ACTIVE" ? "Active since " + fmtDate(p.accepted_at) : p.status === "PENDING" ? (p.initiated_by === businessId ? "Invite sent " + fmtDate(p.invite_sent_at || p.created_at) : "They invited you") : "Revoked " + fmtDate(p.revoked_at)}
                  </p>
                </div>
                <span className={"ui-status " + (p.status === "ACTIVE" ? "ui-pill-success" : p.status === "PENDING" ? "ui-pill-warning" : "ui-pill-neutral")}>{p.status}</span>
                {p.status === "PENDING" && p.initiated_by !== businessId && (
                  <button onClick={() => partnershipAction("accept", p.id)} disabled={busy === p.id} className="ui-btn ui-btn-primary !py-1.5 text-[12px]">Accept</button>
                )}
                {p.status !== "REVOKED" && (
                  <button onClick={() => partnershipAction("revoke", p.id)} disabled={busy === p.id} className="ui-btn ui-btn-danger !py-1.5 text-[12px]">Revoke</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Combo offers ── */}
      <section className="anim-fade-up anim-d2 ui-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Combo Offers</h3>
          <button
            onClick={() => setShowOfferForm((v) => !v)}
            className="ui-btn ui-btn-primary !py-1.5 text-[12px]"
            title="Bundle your own tours, or partner tours once a partnership is active"
          >
            {showOfferForm ? "Close" : "New Combo Offer"}
          </button>
        </div>

        {showOfferForm && (
          <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: "var(--ck-border)" }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Offer name
                <input className="ui-control w-full text-sm" value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder="e.g. Paddle & Peaks Combo" />
              </label>
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Combo price (per person, R)
                <input className="ui-control w-full text-sm" type="number" min="0" value={comboPrice} onChange={(e) => setComboPrice(e.target.value)} />
              </label>
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Normal combined price (optional, shows the saving)
                <input className="ui-control w-full text-sm" type="number" min="0" value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} />
              </label>
              {!allMine && (
                <label className="space-y-1 text-[12px] sm:col-span-3" style={{ color: "var(--ck-text-muted)" }}>
                  Split type
                  <select className="ui-control w-full text-sm sm:max-w-[260px]" value={splitType} onChange={(e) => setSplitType(e.target.value as "PERCENT" | "FIXED")}>
                    <option value="PERCENT">Percentage</option>
                    <option value="FIXED">Fixed amounts (per person)</option>
                  </select>
                </label>
              )}
            </div>

            {/* One row per tour in the combo — row 0 is yours; rows below are
                partner tours OR more of your own ("__self"), so a combo like
                Morning + Evening Kayak needs no partnership at all. */}
            <div className="space-y-2">
              {offerRows.map((row, idx) => {
                const rowTours = idx === 0 || row.partner_id === "__self" ? myTours : (partnerToursCache[row.partner_id] || []);
                return (
                  <div key={idx} className={"grid gap-2 items-end " + (allMine ? "sm:grid-cols-[1fr_1fr_36px]" : "sm:grid-cols-[1fr_1fr_120px_36px]")}>
                    {idx === 0 ? (
                      <p className="text-[12px] pb-2 font-medium" style={{ color: "var(--ck-text-muted)" }}>Your tour</p>
                    ) : (
                      <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                        Operator
                        <select
                          className="ui-control w-full text-sm"
                          value={row.partner_id}
                          onChange={(e) => { updateOfferRow(idx, { partner_id: e.target.value, tour_id: "" }); if (e.target.value && e.target.value !== "__self") loadPartnerTours(e.target.value); }}
                        >
                          <option value="">Select operator…</option>
                          <option value="__self">My own tours</option>
                          {activePartners.map((p) => <option key={p.id} value={p.partner_id}>{p.partner_name}</option>)}
                        </select>
                      </label>
                    )}
                    <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                      Tour
                      <select
                        className="ui-control w-full text-sm"
                        value={row.tour_id}
                        onChange={(e) => updateOfferRow(idx, { tour_id: e.target.value })}
                        disabled={idx > 0 && !row.partner_id}
                      >
                        <option value="">{idx > 0 && !row.partner_id ? "Pick an operator first" : "Select tour…"}</option>
                        {rowTours.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                    {!allMine && (
                      <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                        Share ({splitType === "PERCENT" ? "%" : "R pp"})
                        <input className="ui-control w-full text-sm" type="number" min="0" value={row.share} onChange={(e) => updateOfferRow(idx, { share: e.target.value })} />
                      </label>
                    )}
                    {idx >= 2 ? (
                      <button
                        onClick={() => setOfferRows((rows) => rows.filter((_, i) => i !== idx))}
                        className="ui-btn !px-0 !py-2 text-[12px] text-[var(--ck-danger)]"
                        title="Remove this tour"
                      >
                        &times;
                      </button>
                    ) : <span />}
                  </div>
                );
              })}
              {offerRows.length < 10 && (
                <button
                  onClick={() => setOfferRows((rows) => [...rows, { partner_id: "", tour_id: "", share: "" }])}
                  className="ui-btn !py-1.5 text-[12px]"
                >
                  + Add another tour
                </button>
              )}
            </div>

            {comboPrice && (allMine ? (
              <p className="text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                A combo of your own tours — you keep the full R{comboPrice} per person, paid through your Yoco account. No partnership or settlement involved.
              </p>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                {splitType === "PERCENT"
                  ? `Shares total ${Math.round(offerRows.reduce((a, r) => a + (Number(r.share) || 0), 0) * 100) / 100}% (must be 100%)`
                  : `Shares total R${Math.round(offerRows.reduce((a, r) => a + (Number(r.share) || 0), 0) * 100) / 100} of R${comboPrice} per person`}
                {" — you collect the full payment and settle each partner's share (unless Paysafe auto-split is configured for a 2-tour combo)."}
              </p>
            ))}
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--ck-border)" }}>
              <RuleFields value={newRules} onChange={(patch) => setNewRules((d) => ({ ...d, ...patch }))} />
            </div>
            <button onClick={createOffer} disabled={savingOffer} className="ui-btn ui-btn-primary">{savingOffer ? "Creating…" : "Create Offer"}</button>
          </div>
        )}

        {offers.length === 0 ? (
          <div className="ui-empty">
            <p className="text-[13px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No combo offers</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Bundle one of your tours with a partner&rsquo;s tour at a package price.</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--ck-border)" }}>
            {offers.map((o) => (
              <div key={o.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{o.name}</p>
                    <p className="text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                      {(o.items || []).map((i: any) => i.tours?.name).filter(Boolean).join(" + ") || "Legacy offer"} · R{Number(o.combo_price)} pp · Split: {splitLabel(o)}
                    </p>
                    <p className="text-[12px]" style={{ color: "var(--ck-text-muted)" }}>Rules: {rulesSummary(o)}</p>
                  </div>
                  <span className={"ui-status " + (o.active ? "ui-pill-success" : "ui-pill-neutral")}>{o.active ? "Live" : "Off"}</span>
                  <button
                    onClick={() => { setRulesFor(rulesFor === o.id ? null : o.id); setRulesDraft(draftFromOffer(o)); }}
                    className="ui-btn !py-1.5 text-[12px]"
                  >
                    {rulesFor === o.id ? "Close" : "Rules"}
                  </button>
                  <button onClick={() => toggleOffer(o)} disabled={busy === o.id} className="ui-btn !py-1.5 text-[12px]">
                    {o.active ? "Deactivate" : "Activate"}
                  </button>
                </div>
                {rulesFor === o.id && (
                  <div className="mt-3 space-y-3 rounded-xl border p-3" style={{ borderColor: "var(--ck-border)" }}>
                    <RuleFields value={rulesDraft} onChange={(patch) => setRulesDraft((d) => ({ ...d, ...patch }))} />
                    <button onClick={() => saveRules(o)} disabled={busy === o.id} className="ui-btn ui-btn-primary !py-1.5 text-[12px]">
                      {busy === o.id ? "Saving…" : "Save rules"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Settlements ── */}
      <section className="anim-fade-up anim-d3 ui-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Settlements</h3>
        </div>
        <p className="text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
          For combos paid into one operator&rsquo;s account, this ledger tracks each side&rsquo;s share — everything unsettled, broken down by week, plus the last 7 days of settled history. If you&rsquo;re owed money, generate a Yoco payment link: it&rsquo;s emailed to your partner and flips to Paid automatically when they pay. You can also mark bookings settled manually (e.g. EFT). Everything is stamped into the settlement register (Reports → Settlement Register).
        </p>

        {settlements === null ? (
          <div className="ui-empty"><p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Settlement tracking becomes available once combo deals are enabled on the platform.</p></div>
        ) : settlements.length === 0 ? (
          <div className="ui-empty">
            <p className="text-[13px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Nothing to settle</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Paid combo bookings from the last 7 days will appear here.</p>
          </div>
        ) : settlements.map((s: any) => (
          <div key={s.partner_id} className="space-y-3 rounded-xl border p-4" style={{ borderColor: "var(--ck-border)" }}>
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{s.partner_name}</p>
              {s.unsettled_count > 0 && <span className="ui-status ui-pill-warning">{s.unsettled_count} unsettled</span>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="ui-mono-label !text-[10px]">Collected by me</p>
                <p className="font-display text-[20px] font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{Number(s.total_collected_by_me).toLocaleString()}</p>
              </div>
              <div>
                <p className="ui-mono-label !text-[10px]">I owe partner</p>
                <p className="font-display text-[20px] font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{Number(s.total_owed_to_partner).toLocaleString()}</p>
              </div>
              <div>
                <p className="ui-mono-label !text-[10px]">Partner owes me</p>
                <p className="font-display text-[20px] font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{Number(s.total_owed_to_me).toLocaleString()}</p>
              </div>
            </div>
            {(s.weekly || []).length > 0 && (
              <div className="overflow-x-auto">
                <p className="ui-mono-label !text-[10px] mb-1">Owed by week (all unsettled combos)</p>
                <table className="w-full text-left text-[12.5px]">
                  <thead>
                    <tr className="ui-mono-label !text-[10px]">
                      <th className="py-1 pr-3">Week starting</th>
                      <th className="py-1 pr-3 text-right">Partner owes me</th>
                      <th className="py-1 pr-3 text-right">I owe partner</th>
                      <th className="py-1 text-right">Combos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.weekly.map((w: any) => (
                      <tr key={w.week_start} style={{ color: "var(--ck-text)" }}>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(w.week_start)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">R{Number(w.owed_to_me).toLocaleString()}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">R{Number(w.owed_to_partner).toLocaleString()}</td>
                        <td className="py-1.5 text-right tabular-nums">{w.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(s.bookings || []).length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead>
                    <tr className="ui-mono-label !text-[10px]">
                      <th className="py-1 pr-3">Date</th>
                      <th className="py-1 pr-3">Combo</th>
                      <th className="py-1 pr-3 text-right">Total</th>
                      <th className="py-1 pr-3 text-right">My share</th>
                      <th className="py-1 pr-3 text-right">Partner share</th>
                      <th className="py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.bookings.map((b: any) => (
                      <tr key={b.id} style={{ color: "var(--ck-text)" }}>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(b.date)}</td>
                        <td className="py-1.5 pr-3">{b.combo_name}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">R{Number(b.total).toLocaleString()}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">R{Number(b.my_share).toLocaleString()}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">R{Number(b.partner_share).toLocaleString()}</td>
                        <td className="py-1.5"><span className={"ui-status " + (b.settled ? "ui-pill-success" : "ui-pill-warning")}>{b.settled ? "Settled" : "Open"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(() => {
              const pr = s.payment_request;
              const owedToMe = Number(s.total_owed_to_me || 0);
              const pendingToMe = pr?.status === "PENDING_PAYMENT" && pr.direction === "OWED_TO_ME";
              const pendingIOwe = pr?.status === "PENDING_PAYMENT" && pr.direction === "I_OWE";
              const amountChanged = pendingToMe && Number(pr.amount_owed) !== owedToMe;
              if (!pr && owedToMe <= 0) return null;
              return (
                <div className="flex flex-wrap items-center gap-2">
                  {pr?.status === "PAID" && (
                    <span className="ui-status ui-pill-success">
                      Paid · R{Number(pr.amount_owed).toLocaleString()}{pr.paid_at ? " · " + fmtDate(pr.paid_at) : ""}
                    </span>
                  )}
                  {pendingToMe && (
                    <>
                      <span className="ui-status ui-pill-warning">
                        Payment link sent · R{Number(pr.amount_owed).toLocaleString()} · awaiting payment
                      </span>
                      {pr.payment_url && (
                        <button
                          className="ui-btn !py-1.5 text-[12px]"
                          onClick={() => { navigator.clipboard.writeText(pr.payment_url); notify({ title: "Link copied", message: "Paste it anywhere your partner can click it.", tone: "success" }); }}
                        >
                          Copy link
                        </button>
                      )}
                    </>
                  )}
                  {pendingIOwe && pr.payment_url && (
                    <a className="ui-btn ui-btn-primary !py-1.5 text-[12px]" href={pr.payment_url} target="_blank" rel="noreferrer">
                      Pay R{Number(pr.amount_owed).toLocaleString()} now
                    </a>
                  )}
                  {owedToMe > 0 && (!pendingToMe || amountChanged) && (
                    <button
                      onClick={() => generatePaymentLink(s)}
                      disabled={linkBusy === s.partner_id}
                      className="ui-btn ui-btn-primary !py-1.5 text-[12px]"
                    >
                      {linkBusy === s.partner_id
                        ? "Creating…"
                        : (amountChanged ? "Regenerate link · R" : "Generate payment link · R") + owedToMe.toLocaleString()}
                    </button>
                  )}
                </div>
              );
            })()}
            {s.unsettled_count > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="ui-control flex-1 text-sm"
                  placeholder="Settlement note (e.g. EFT ref) — optional"
                  value={settleNotes[s.partner_id] || ""}
                  onChange={(e) => setSettleNotes((n) => ({ ...n, [s.partner_id]: e.target.value }))}
                />
                <button onClick={() => markSettled(s)} disabled={settling === s.partner_id} className="ui-btn ui-btn-primary">
                  {settling === s.partner_id ? "Recording…" : `Mark ${s.unsettled_count} Settled`}
                </button>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
