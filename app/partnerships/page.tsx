"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { useBusinessContext } from "../../components/BusinessContext";
import { isComboEnabledClient } from "../lib/feature-flags";

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: getAdminTimezone() });
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

  // Offer create form
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerPartnerId, setOfferPartnerId] = useState("");
  const [myTours, setMyTours] = useState<any[]>([]);
  const [partnerTours, setPartnerTours] = useState<any[]>([]);
  const [myTourId, setMyTourId] = useState("");
  const [partnerTourId, setPartnerTourId] = useState("");
  const [offerName, setOfferName] = useState("");
  const [comboPrice, setComboPrice] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [splitType, setSplitType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [myShare, setMyShare] = useState("50");
  const [savingOffer, setSavingOffer] = useState(false);

  // Settlement notes per partner
  const [settleNotes, setSettleNotes] = useState<Record<string, string>>({});
  const [settling, setSettling] = useState<string | null>(null);
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

  useEffect(() => {
    if (!offerPartnerId) { setPartnerTours([]); return; }
    (async () => {
      const headers = await authHeaders();
      const r = await fetch(`/api/partner-tours?partner_id=${offerPartnerId}`, { headers });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { notify({ title: "Could not load partner tours", message: d.error || "", tone: "error" }); return; }
      setPartnerTours(d.tours || []);
    })();
  }, [offerPartnerId]);

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
    const share = Number(myShare);
    if (!offerPartnerId || !myTourId || !partnerTourId || !offerName.trim() || !price) {
      notify({ title: "Missing fields", message: "Partner, both tours, a name and a combo price are required.", tone: "error" });
      return;
    }
    const partnerShare = splitType === "PERCENT" ? 100 - share : Math.round((price - share) * 100) / 100;
    if (splitType === "PERCENT" && (share <= 0 || share >= 100)) {
      notify({ title: "Invalid split", message: "Your percentage must be between 0 and 100.", tone: "error" });
      return;
    }
    if (splitType === "FIXED" && (share <= 0 || share >= price)) {
      notify({ title: "Invalid split", message: "Your fixed share must be between 0 and the combo price.", tone: "error" });
      return;
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
        split_type: splitType,
        items: [
          { business_id: businessId, tour_id: myTourId, split_percent: splitType === "PERCENT" ? share : undefined, split_fixed: splitType === "FIXED" ? share : undefined },
          { business_id: offerPartnerId, tour_id: partnerTourId, split_percent: splitType === "PERCENT" ? partnerShare : undefined, split_fixed: splitType === "FIXED" ? partnerShare : undefined },
        ],
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) notify({ title: "Could not create offer", message: d.error || "Unknown error", tone: "error" });
    else {
      notify({ title: "Combo offer created", message: "It is live on your booking site's combo section.", tone: "success" });
      setShowOfferForm(false);
      setOfferName(""); setComboPrice(""); setOriginalPrice(""); setMyTourId(""); setPartnerTourId("");
      load();
    }
    setSavingOffer(false);
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
      body: JSON.stringify({ combo_booking_ids: ids, notes: settleNotes[partner.partner_id] || null }),
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
            disabled={activePartners.length === 0}
            className="ui-btn ui-btn-primary !py-1.5 text-[12px]"
            title={activePartners.length === 0 ? "You need an active partnership first" : ""}
          >
            {showOfferForm ? "Close" : "New Combo Offer"}
          </button>
        </div>

        {showOfferForm && (
          <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: "var(--ck-border)" }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Partner
                <select className="ui-control w-full text-sm" value={offerPartnerId} onChange={(e) => { setOfferPartnerId(e.target.value); setPartnerTourId(""); }}>
                  <option value="">Select partner…</option>
                  {activePartners.map((p) => <option key={p.id} value={p.partner_id}>{p.partner_name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Offer name
                <input className="ui-control w-full text-sm" value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder="e.g. Paddle & Peaks Combo" />
              </label>
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Your tour
                <select className="ui-control w-full text-sm" value={myTourId} onChange={(e) => setMyTourId(e.target.value)}>
                  <option value="">Select your tour…</option>
                  {myTours.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Partner&rsquo;s tour
                <select className="ui-control w-full text-sm" value={partnerTourId} onChange={(e) => setPartnerTourId(e.target.value)} disabled={!offerPartnerId}>
                  <option value="">{offerPartnerId ? "Select their tour…" : "Pick a partner first"}</option>
                  {partnerTours.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Combo price (per person, R)
                <input className="ui-control w-full text-sm" type="number" min="0" value={comboPrice} onChange={(e) => setComboPrice(e.target.value)} />
              </label>
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Normal combined price (optional, shows the saving)
                <input className="ui-control w-full text-sm" type="number" min="0" value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} />
              </label>
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Split type
                <select className="ui-control w-full text-sm" value={splitType} onChange={(e) => setSplitType(e.target.value as "PERCENT" | "FIXED")}>
                  <option value="PERCENT">Percentage</option>
                  <option value="FIXED">Fixed amounts (per person)</option>
                </select>
              </label>
              <label className="space-y-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                Your share ({splitType === "PERCENT" ? "%" : "R per person"})
                <input className="ui-control w-full text-sm" type="number" min="0" value={myShare} onChange={(e) => setMyShare(e.target.value)} />
              </label>
            </div>
            {comboPrice && myShare && (
              <p className="text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                {splitType === "PERCENT"
                  ? `You ${myShare}% · Partner ${100 - Number(myShare)}%`
                  : `You R${myShare} · Partner R${Math.round((Number(comboPrice) - Number(myShare)) * 100) / 100} per person`}
                {" — you collect the full payment and settle your partner's share (unless Paysafe auto-split is configured)."}
              </p>
            )}
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
              <div key={o.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{o.name}</p>
                  <p className="text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
                    {(o.items || []).map((i: any) => i.tours?.name).filter(Boolean).join(" + ") || "Legacy offer"} · R{Number(o.combo_price)} pp · Split: {splitLabel(o)}
                  </p>
                </div>
                <span className={"ui-status " + (o.active ? "ui-pill-success" : "ui-pill-neutral")}>{o.active ? "Live" : "Off"}</span>
                <button onClick={() => toggleOffer(o)} disabled={busy === o.id} className="ui-btn !py-1.5 text-[12px]">
                  {o.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Settlements ── */}
      <section className="anim-fade-up anim-d3 ui-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Settlements (last 7 days)</h3>
        </div>
        <p className="text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
          For combos paid into one operator&rsquo;s account, this ledger tracks each side&rsquo;s share. When you&rsquo;ve paid your partner (or been paid), mark it settled — it&rsquo;s stamped into the settlement register (Reports → Settlement Register).
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
