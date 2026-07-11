"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { confirmAction, notify } from "../lib/app-notify";
import { useBusinessContext } from "../../components/BusinessContext";
import Link from "next/link";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { UsersThree, Article, PaperPlaneTilt, Megaphone, ChartBar, Plus } from "@phosphor-icons/react";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  total_recipients: number;
  total_sent: number;
  total_failed: number;
  total_opens: number;
  total_clicks: number;
  total_unsubscribes: number;
  total_bounces: number;
  created_at: string;
  scheduled_at: string | null;
}

function pct(num: number, den: number) {
  if (!den) return "0%";
  return (num / den * 100).toFixed(1) + "%";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

// Mono axis ticks — the instrument voice on chart axes.
const axisTick = { fontSize: 10.5, fontFamily: "var(--font-mono)", fill: "var(--ck-text-muted)" } as const;

// Multi-series tooltip styled as a ui-card: mono label + colored dots + Inter values.
function ChartTooltip({ active, payload, label, suffix = "" }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: "var(--ck-surface)", border: "1px solid var(--ck-border-subtle)", borderRadius: 12, boxShadow: "var(--ck-shadow-md)", padding: "8px 11px" }}>
      <div className="ui-mono-label !text-[9.5px]" style={{ marginBottom: 4 }}>{label}</div>
      <div className="space-y-1">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-[12px]">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.stroke || p.fill }} />
            <span style={{ color: "var(--ck-text-muted)" }}>{p.name}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{p.value}{suffix}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Campaign status → shared pill vocabulary (dotless, mono, soft wash).
const CAMPAIGN_PILL: Record<string, string> = {
  draft: "ui-pill-neutral",
  pending: "ui-pill-warning",
  scheduled: "ui-pill-ocean",
  sending: "ui-pill-accent",
  paused: "ui-pill-warning",
  done: "ui-pill-success",
  cancelled: "ui-pill-danger",
};

export default function MarketingOverview() {
  const { businessId } = useBusinessContext();
  const [contacts, setContacts] = useState(0);
  const [unsubscribed, setUnsubscribed] = useState(0);
  const [bounced, setBounced] = useState(0);
  const [templates, setTemplates] = useState(0);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [emailsSent, setEmailsSent] = useState(0);
  const [includedEmails, setIncludedEmails] = useState(500);
  const [overageRate, setOverageRate] = useState(0.15);
  const [monthlyUsage, setMonthlyUsage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    async function load() {
      const currentPeriod = new Date().toISOString().slice(0, 7);
      const [activeRes, unsubRes, bouncedRes, tRes, campRes, bizRes, usageRes] = await Promise.all([
        supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "active"),
        supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "unsubscribed"),
        supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "bounced"),
        supabase.from("marketing_templates").select("id", { count: "exact", head: true }).eq("business_id", businessId),
        supabase.from("marketing_campaigns")
          .select("id, name, status, total_recipients, total_sent, total_failed, total_opens, total_clicks, total_unsubscribes, total_bounces, created_at, scheduled_at")
          .eq("business_id", businessId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("businesses").select("marketing_email_usage, marketing_included_emails, marketing_overage_rate_zar").eq("id", businessId).single(),
        supabase.from("marketing_usage_monthly").select("emails_sent").eq("business_id", businessId).eq("period", currentPeriod).maybeSingle(),
      ]);
      setContacts(activeRes.count || 0);
      setUnsubscribed(unsubRes.count || 0);
      setBounced(bouncedRes.count || 0);
      setTemplates(tRes.count || 0);
      setCampaigns((campRes.data as CampaignRow[]) || []);
      setEmailsSent(bizRes.data?.marketing_email_usage || 0);
      setIncludedEmails(bizRes.data?.marketing_included_emails || 500);
      setOverageRate(bizRes.data?.marketing_overage_rate_zar || 0.15);
      setMonthlyUsage(usageRes.data?.emails_sent || 0);
      setLoading(false);
    }
    load();
  }, [businessId]);

  if (loading) {
    return <div className="space-y-4 py-2"><div className="ui-skeleton h-8 w-48" /><div className="ui-skeleton h-[140px] !rounded-2xl" /><div className="ui-skeleton h-[320px] !rounded-2xl" /></div>;
  }

  const totalSent = campaigns.reduce((s, c) => s + (c.total_sent || 0), 0);
  const totalOpens = campaigns.reduce((s, c) => s + (c.total_opens || 0), 0);
  const totalClicks = campaigns.reduce((s, c) => s + (c.total_clicks || 0), 0);
  const totalUnsub = campaigns.reduce((s, c) => s + (c.total_unsubscribes || 0), 0);

  async function cancelCampaign(c: CampaignRow) {
    const wording = c.status === "scheduled"
      ? "Cancel the scheduled campaign \"" + c.name + "\"? It will not fire at its scheduled time."
      : "Stop sending campaign \"" + c.name + "\"? Pending recipients in the queue will be skipped. Already-delivered emails cannot be recalled.";
    if (!await confirmAction({
      title: c.status === "scheduled" ? "Cancel scheduled campaign" : "Pause campaign",
      message: wording,
      tone: "warning",
      confirmLabel: c.status === "scheduled" ? "Cancel campaign" : "Stop sending",
    })) return;
    // marketing-dispatch's claim loop guards on status === "sending"; flipping
    // the row to cancelled stops new queue items being claimed for this id.
    const { error: campErr } = await supabase
      .from("marketing_campaigns")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", c.id)
      .eq("business_id", businessId);
    if (campErr) {
      notify({ title: "Could not stop campaign", message: campErr.message, tone: "error" });
      return;
    }
    // Best-effort clean-up: drop any pending queue items so the failed
    // counter doesn't tick up after the operator has already aborted.
    await supabase
      .from("marketing_queue")
      .update({ status: "cancelled" })
      .eq("campaign_id", c.id)
      .eq("business_id", businessId)
      .in("status", ["pending", "processing"]);
    notify({
      title: c.status === "scheduled" ? "Scheduled campaign cancelled" : "Campaign stopped",
      message: c.status === "scheduled"
        ? "\"" + c.name + "\" will not fire."
        : "\"" + c.name + "\" stopped. " + (c.total_sent || 0) + " of " + (c.total_recipients || 0) + " already delivered.",
      tone: "success",
    });
    setCampaigns((prev) => prev.map((row) => row.id === c.id ? { ...row, status: "cancelled" } : row));
  }

  // Build campaign performance data for charts (most recent first → reverse for chronological)
  const campaignChartData = [...campaigns]
    .filter(c => c.total_sent > 0)
    .reverse()
    .slice(-8)
    .map(c => ({
      name: c.name.length > 16 ? c.name.slice(0, 14) + "…" : c.name,
      sent: c.total_sent,
      opens: c.total_opens,
      clicks: c.total_clicks,
      openRate: c.total_sent ? +(c.total_opens / c.total_sent * 100).toFixed(1) : 0,
      clickRate: c.total_sent ? +(c.total_clicks / c.total_sent * 100).toFixed(1) : 0,
    }));

  // Audience breakdown for donut chart
  const audienceData = [
    { name: "Active", value: contacts, color: "var(--ck-success)" },
    { name: "Unsubscribed", value: unsubscribed, color: "var(--ck-amber)" },
    { name: "Bounced", value: bounced, color: "var(--ck-danger)" },
  ].filter(d => d.value > 0);
  const totalAudience = contacts + unsubscribed + bounced;

  // Usage percentage
  const usagePct = includedEmails > 0 ? Math.min(100, (monthlyUsage / includedEmails) * 100) : 0;
  const usageColor = monthlyUsage >= includedEmails ? "var(--ck-danger)" : monthlyUsage >= includedEmails * 0.8 ? "var(--ck-warning)" : "var(--ck-accent)";

  return (
    <div className="space-y-6">
      {/* ── KPI Cards ── */}
      <div className="anim-fade-up grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Active Contacts", value: contacts.toLocaleString(), delta: unsubscribed > 0 ? `${unsubscribed} unsub` : undefined, chipBg: "var(--ck-ocean-soft)", chipColor: "var(--ck-ocean)", icon: <UsersThree size={18} weight="fill" /> },
          { label: "Templates", value: templates, delta: undefined, chipBg: "rgba(62, 124, 166, 0.12)", chipColor: "var(--ck-fjord)", icon: <Article size={18} weight="fill" /> },
          { label: "Emails Sent", value: emailsSent.toLocaleString(), delta: monthlyUsage > 0 ? `${monthlyUsage} this month` : undefined, chipBg: "var(--ck-accent-soft)", chipColor: "var(--ck-accent)", icon: <PaperPlaneTilt size={18} weight="fill" /> },
          { label: "Campaigns", value: campaigns.length, delta: campaigns.filter(c => c.status === "done").length > 0 ? `${campaigns.filter(c => c.status === "done").length} completed` : undefined, chipBg: "var(--ck-amber-soft)", chipColor: "var(--ck-amber)", icon: <Megaphone size={18} weight="fill" /> },
        ].map((kpi) => (
          <div key={kpi.label} className="ui-card ui-card-hover p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="ui-icon-chip" style={{ background: kpi.chipBg, color: kpi.chipColor }}>{kpi.icon}</span>
              <span className="ui-mono-label !text-[10px]">{kpi.label}</span>
            </div>
            <p className="font-display text-[30px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{kpi.value}</p>
            {kpi.delta && <p className="mt-1.5 text-xs" style={{ color: "var(--ck-text-muted)" }}>{kpi.delta}</p>}
          </div>
        ))}
      </div>

      {/* ── Email Usage ── */}
      <div className="anim-fade-up anim-d1 ui-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Email Usage This Month</h3>
          <span className="font-mono text-xs font-semibold tabular-nums" style={{ color: usageColor }}>{usagePct.toFixed(0)}%</span>
        </div>
        <div className="ui-progress !h-2.5">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: usagePct + "%", background: usageColor }} />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{monthlyUsage.toLocaleString()} of {includedEmails.toLocaleString()} included</p>
          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>R{overageRate.toFixed(2)}/email over quota</p>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Emails sent all-time: {emailsSent.toLocaleString()}</p>
          <p className="text-xs font-medium" style={{ color: monthlyUsage > includedEmails ? "var(--ck-danger)" : "var(--ck-text-muted)" }}>
            Cost this month: R{(Math.max(0, monthlyUsage - includedEmails) * overageRate).toFixed(2)}
          </p>
        </div>
      </div>

      {/* ── Charts Row ── */}
      <div className="anim-fade-up anim-d2 grid gap-6 lg:grid-cols-3">
        {/* Engagement Rates */}
        <div className="ui-card p-5 lg:col-span-1">
          <h3 className="mb-4 text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Engagement Overview</h3>
          {totalSent > 0 ? (
            <div className="space-y-4">
              {[
                { label: "Open Rate", value: pct(totalOpens, totalSent), raw: totalOpens, color: "var(--ck-ocean)", pctNum: totalSent ? totalOpens / totalSent * 100 : 0 },
                { label: "Click Rate", value: pct(totalClicks, totalSent), raw: totalClicks, color: "var(--ck-success)", pctNum: totalSent ? totalClicks / totalSent * 100 : 0 },
                { label: "Unsubscribe Rate", value: pct(totalUnsub, totalSent), raw: totalUnsub, color: "var(--ck-amber)", pctNum: totalSent ? totalUnsub / totalSent * 100 : 0 },
                { label: "Bounce Rate", value: pct(bounced, totalSent), raw: bounced, color: "var(--ck-danger)", pctNum: totalSent ? bounced / totalSent * 100 : 0 },
              ].map((m) => (
                <div key={m.label}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium" style={{ color: "var(--ck-text)" }}>{m.label}</span>
                    <span className="text-sm font-bold tabular-nums" style={{ color: m.color }}>{m.value}</span>
                  </div>
                  <div className="ui-progress !h-1.5">
                    <div className="h-full rounded-full transition-all" style={{ width: Math.min(100, m.pctNum) + "%", background: m.color }} />
                  </div>
                  <p className="mt-0.5 text-right text-[10px]" style={{ color: "var(--ck-text-muted)" }}>{m.raw.toLocaleString()} total</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="ui-empty !py-8">
              <span className="ui-icon-chip"><ChartBar size={19} /></span>
              <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Send your first campaign to see engagement data</p>
            </div>
          )}
        </div>

        {/* Campaign Performance Chart */}
        <div className="ui-card p-5 lg:col-span-2">
          <h3 className="mb-4 text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Campaign Performance</h3>
          {campaignChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={campaignChartData} barGap={4}>
                <CartesianGrid stroke="var(--ck-chart-grid)" vertical={false} />
                <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={35} />
                <Tooltip cursor={{ fill: "var(--ck-surface-sunken)" }} content={<ChartTooltip />} />
                <Bar dataKey="sent" name="Sent" fill="var(--ck-chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="opens" name="Opens" fill="var(--ck-chart-2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="clicks" name="Clicks" fill="var(--ck-chart-4)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="ui-empty">
              <span className="ui-icon-chip"><ChartBar size={19} /></span>
              <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No campaign data yet</p>
              <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Charts will appear after your first send</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Audience + Open Rate Trend ── */}
      <div className="anim-fade-up anim-d3 grid gap-6 lg:grid-cols-2">
        {/* Audience Breakdown Donut */}
        <div className="ui-card p-5">
          <h3 className="mb-4 text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Audience Breakdown</h3>
          {totalAudience > 0 ? (
            <div className="flex items-center gap-6">
              <div className="h-32 w-32 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={audienceData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {audienceData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-3">
                {audienceData.map((seg) => (
                  <div key={seg.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ background: seg.color }} />
                      <span className="text-sm" style={{ color: "var(--ck-text)" }}>{seg.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{seg.value.toLocaleString()}</span>
                      <span className="ml-1.5 text-xs tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{(seg.value / totalAudience * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="ui-empty !py-6">
              <span className="ui-icon-chip"><UsersThree size={19} /></span>
              <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Import contacts to see audience breakdown</p>
            </div>
          )}
        </div>

        {/* Open Rate Trend */}
        <div className="ui-card p-5">
          <h3 className="mb-4 text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Open Rate Trend</h3>
          {campaignChartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={campaignChartData}>
                <defs>
                  <linearGradient id="openRateGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ck-chart-1)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--ck-chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--ck-chart-grid)" vertical={false} />
                <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={30} unit="%" />
                <Tooltip cursor={{ stroke: "var(--ck-border-strong)", strokeDasharray: "3 3" }} content={<ChartTooltip suffix="%" />} />
                <Area type="monotone" dataKey="openRate" name="Open Rate" stroke="var(--ck-chart-1)" fill="url(#openRateGrad)" strokeWidth={2} dot={{ r: 3, fill: "var(--ck-chart-1)" }} />
                <Area type="monotone" dataKey="clickRate" name="Click Rate" stroke="var(--ck-chart-2)" fill="none" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: "var(--ck-chart-2)" }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="ui-empty !py-6">
              <span className="ui-icon-chip"><ChartBar size={19} /></span>
              <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Need 2+ campaigns to show trends</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="flex flex-wrap gap-3">
        <Link href="/marketing/contacts" className="ui-btn ui-btn-primary">
          <Plus size={15} weight="bold" /> Add Contacts
        </Link>
        <Link href="/marketing/templates" className="ui-btn ui-btn-ghost">
          <Plus size={15} weight="bold" /> Create Template
        </Link>
      </div>

      {/* ── Recent Campaigns Table ── */}
      <div className="anim-fade-up">
        <h2 className="ui-mono-label mb-3 !text-[11px]">Recent Campaigns</h2>
        {campaigns.length === 0 ? (
          <div className="ui-card">
            <div className="ui-empty">
              <span className="ui-icon-chip"><PaperPlaneTilt size={19} /></span>
              <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No campaigns yet</p>
              <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Create a template, then send your first campaign</p>
            </div>
          </div>
        ) : (
          <div className="ui-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr>
                    <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-left" style={{ borderColor: "var(--ck-border-subtle)" }}>Campaign</th>
                    <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-left" style={{ borderColor: "var(--ck-border-subtle)" }}>Status</th>
                    <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-right" style={{ borderColor: "var(--ck-border-subtle)" }}>Sent</th>
                    <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-right" style={{ borderColor: "var(--ck-border-subtle)" }}>Opens</th>
                    <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-right" style={{ borderColor: "var(--ck-border-subtle)" }}>Clicks</th>
                    <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-right" style={{ borderColor: "var(--ck-border-subtle)" }}>Unsub</th>
                    <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-right" style={{ borderColor: "var(--ck-border-subtle)" }}>Date</th>
                    <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-right" style={{ borderColor: "var(--ck-border-subtle)" }}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                  {campaigns.map((c) => {
                    const canCancel = c.status === "sending" || c.status === "scheduled";
                    return (
                    <tr key={c.id} className="transition-colors hover:bg-[var(--ck-surface-sunken)]">
                      <td className="px-4 py-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{c.name}</td>
                      <td className="px-4 py-3"><CampaignStatusBadge status={c.status} /></td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums" style={{ color: "var(--ck-text)" }}>
                        {c.total_sent}/{c.total_recipients}
                        {c.total_failed > 0 && <span className="ml-1" style={{ color: "var(--ck-danger)" }}>({c.total_failed})</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--ck-text)" }}>
                        {c.total_opens > 0 ? <>{c.total_opens} <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>({pct(c.total_opens, c.total_sent)})</span></> : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--ck-text)" }}>
                        {c.total_clicks > 0 ? <>{c.total_clicks} <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>({pct(c.total_clicks, c.total_sent)})</span></> : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: c.total_unsubscribes > 0 ? "var(--ck-amber)" : "var(--ck-text-muted)" }}>
                        {c.total_unsubscribes || "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs" style={{ color: "var(--ck-text-muted)" }}>
                        {c.scheduled_at && c.status === "scheduled" ? fmtDate(c.scheduled_at) : fmtDate(c.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canCancel ? (
                          <button
                            type="button"
                            onClick={() => cancelCampaign(c)}
                            className="ui-btn ui-btn-danger h-7 px-2.5 text-[11px]"
                            title={c.status === "scheduled" ? "Cancel before it fires" : "Stop sending remaining recipients"}
                          >
                            {c.status === "scheduled" ? "Cancel" : "Pause"}
                          </button>
                        ) : (
                          <span style={{ color: "var(--ck-text-muted)" }}>—</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignStatusBadge({ status }: { status: string }) {
  return <span className={`ui-status ${CAMPAIGN_PILL[status] || "ui-pill-neutral"}`}>{status}</span>;
}
