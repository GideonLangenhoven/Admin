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
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "var(--ck-accent)" }} /></div>;
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
    { name: "Active", value: contacts, color: "#10b981" },
    { name: "Unsubscribed", value: unsubscribed, color: "#f59e0b" },
    { name: "Bounced", value: bounced, color: "#ef4444" },
  ].filter(d => d.value > 0);
  const totalAudience = contacts + unsubscribed + bounced;

  // Usage percentage
  const usagePct = includedEmails > 0 ? Math.min(100, (monthlyUsage / includedEmails) * 100) : 0;
  const usageColor = monthlyUsage >= includedEmails ? "#ef4444" : monthlyUsage >= includedEmails * 0.8 ? "#f59e0b" : "var(--ck-accent)";

  return (
    <div className="space-y-6">
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Active Contacts", value: contacts.toLocaleString(), delta: unsubscribed > 0 ? `${unsubscribed} unsub` : undefined, accent: "#3b82f6" },
          { label: "Templates", value: templates, accent: "#8b5cf6" },
          { label: "Emails Sent", value: emailsSent.toLocaleString(), delta: monthlyUsage > 0 ? `${monthlyUsage} this month` : undefined, accent: "#10b981" },
          { label: "Campaigns", value: campaigns.length, delta: campaigns.filter(c => c.status === "done").length > 0 ? `${campaigns.filter(c => c.status === "done").length} completed` : undefined, accent: "#f59e0b" },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border p-5 relative overflow-hidden" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
            <div className="absolute top-0 left-0 w-full h-0.5" style={{ background: kpi.accent }} />
            <p className="text-xs font-medium tracking-wide uppercase" style={{ color: "var(--ck-text-muted)" }}>{kpi.label}</p>
            <p className="text-3xl font-bold mt-1" style={{ color: "var(--ck-text-strong)" }}>{kpi.value}</p>
            {kpi.delta && <p className="text-xs mt-1" style={{ color: "var(--ck-text-muted)" }}>{kpi.delta}</p>}
          </div>
        ))}
      </div>

      {/* ── Email Usage ── */}
      <div className="rounded-xl border p-5" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Email Usage This Month</h3>
          <span className="text-xs font-mono font-semibold" style={{ color: usageColor }}>{usagePct.toFixed(0)}%</span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--ck-border)" }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: usagePct + "%", background: usageColor }} />
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{monthlyUsage.toLocaleString()} of {includedEmails.toLocaleString()} included</p>
          {monthlyUsage >= includedEmails && (
            <p className="text-xs font-medium" style={{ color: "#ef4444" }}>
              Overage: R{((monthlyUsage - includedEmails) * overageRate).toFixed(2)}
            </p>
          )}
        </div>
      </div>

      {/* ── Charts Row ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Engagement Rates */}
        <div className="rounded-xl border p-5 lg:col-span-1" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ck-text-strong)" }}>Engagement Overview</h3>
          {totalSent > 0 ? (
            <div className="space-y-4">
              {[
                { label: "Open Rate", value: pct(totalOpens, totalSent), raw: totalOpens, color: "#3b82f6", pctNum: totalSent ? totalOpens / totalSent * 100 : 0 },
                { label: "Click Rate", value: pct(totalClicks, totalSent), raw: totalClicks, color: "#10b981", pctNum: totalSent ? totalClicks / totalSent * 100 : 0 },
                { label: "Unsubscribe Rate", value: pct(totalUnsub, totalSent), raw: totalUnsub, color: "#f59e0b", pctNum: totalSent ? totalUnsub / totalSent * 100 : 0 },
                { label: "Bounce Rate", value: pct(bounced, totalSent), raw: bounced, color: "#ef4444", pctNum: totalSent ? bounced / totalSent * 100 : 0 },
              ].map((m) => (
                <div key={m.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium" style={{ color: "var(--ck-text)" }}>{m.label}</span>
                    <span className="text-sm font-bold" style={{ color: m.color }}>{m.value}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--ck-border)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: Math.min(100, m.pctNum) + "%", background: m.color }} />
                  </div>
                  <p className="text-[10px] mt-0.5 text-right" style={{ color: "var(--ck-text-muted)" }}>{m.raw.toLocaleString()} total</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40">
              <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Send your first campaign to see engagement data</p>
            </div>
          )}
        </div>

        {/* Campaign Performance Chart */}
        <div className="rounded-xl border p-5 lg:col-span-2" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ck-text-strong)" }}>Campaign Performance</h3>
          {campaignChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={campaignChartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ck-border-strong)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--ck-text-muted)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--ck-text-muted)" }} axisLine={false} tickLine={false} width={35} />
                <Tooltip
                  contentStyle={{ background: "var(--ck-surface-elevated)", borderColor: "var(--ck-border-strong)", borderRadius: 10, fontSize: 12, color: "var(--ck-text-strong)" }}
                  labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                />
                <Bar dataKey="sent" name="Sent" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="opens" name="Opens" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="clicks" name="Clicks" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-60">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: "var(--ck-border)" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ck-text-muted)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 17V13M12 17V9M17 17V5"/></svg>
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--ck-text-muted)" }}>No campaign data yet</p>
                <p className="text-xs mt-1" style={{ color: "var(--ck-text-muted)" }}>Charts will appear after your first send</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Audience + Open Rate Trend ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Audience Breakdown Donut */}
        <div className="rounded-xl border p-5" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ck-text-strong)" }}>Audience Breakdown</h3>
          {totalAudience > 0 ? (
            <div className="flex items-center gap-6">
              <div className="w-32 h-32 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={audienceData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {audienceData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--ck-surface-elevated)", borderColor: "var(--ck-border-strong)", borderRadius: 10, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3 flex-1">
                {audienceData.map((seg) => (
                  <div key={seg.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: seg.color }} />
                      <span className="text-sm" style={{ color: "var(--ck-text)" }}>{seg.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold" style={{ color: "var(--ck-text-strong)" }}>{seg.value.toLocaleString()}</span>
                      <span className="text-xs ml-1.5" style={{ color: "var(--ck-text-muted)" }}>{(seg.value / totalAudience * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32">
              <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Import contacts to see audience breakdown</p>
            </div>
          )}
        </div>

        {/* Open Rate Trend */}
        <div className="rounded-xl border p-5" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--ck-text-strong)" }}>Open Rate Trend</h3>
          {campaignChartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={campaignChartData}>
                <defs>
                  <linearGradient id="openRateGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ck-border-strong)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--ck-text-muted)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--ck-text-muted)" }} axisLine={false} tickLine={false} width={30} unit="%" />
                <Tooltip contentStyle={{ background: "var(--ck-surface-elevated)", borderColor: "var(--ck-border-strong)", borderRadius: 10, fontSize: 12 }} />
                <Area type="monotone" dataKey="openRate" name="Open Rate" stroke="#3b82f6" fill="url(#openRateGrad)" strokeWidth={2} dot={{ r: 3, fill: "#3b82f6" }} />
                <Area type="monotone" dataKey="clickRate" name="Click Rate" stroke="#10b981" fill="none" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: "#10b981" }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-36">
              <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Need 2+ campaigns to show trends</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="flex flex-wrap gap-3">
        <Link href="/marketing/contacts" className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: "var(--ck-accent)", color: "var(--ck-btn-primary-text)" }}>
          + Add Contacts
        </Link>
        <Link href="/marketing/templates" className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
          + Create Template
        </Link>
      </div>

      {/* ── Recent Campaigns Table ── */}
      <div>
        <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>Recent Campaigns</h2>
        {campaigns.length === 0 ? (
          <div className="rounded-xl border p-10 text-center" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
            <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: "var(--ck-border)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ck-text-muted)" strokeWidth="1.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--ck-text)" }}>No campaigns yet</p>
            <p className="text-xs mt-1" style={{ color: "var(--ck-text-muted)" }}>Create a template, then send your first campaign</p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--ck-border)" }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr style={{ background: "var(--ck-surface)" }}>
                    <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>Campaign</th>
                    <th className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>Status</th>
                    <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>Sent</th>
                    <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>Opens</th>
                    <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>Clicks</th>
                    <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>Unsub</th>
                    <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>Date</th>
                    <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const canCancel = c.status === "sending" || c.status === "scheduled";
                    return (
                    <tr key={c.id} className="border-t transition-colors hover:opacity-80" style={{ borderColor: "var(--ck-border)" }}>
                      <td className="px-4 py-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{c.name}</td>
                      <td className="px-4 py-3"><CampaignStatusBadge status={c.status} /></td>
                      <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: "var(--ck-text)" }}>
                        {c.total_sent}/{c.total_recipients}
                        {c.total_failed > 0 && <span className="text-red-500 ml-1">({c.total_failed})</span>}
                      </td>
                      <td className="px-4 py-3 text-right" style={{ color: "var(--ck-text)" }}>
                        {c.total_opens > 0 ? <>{c.total_opens} <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>({pct(c.total_opens, c.total_sent)})</span></> : "—"}
                      </td>
                      <td className="px-4 py-3 text-right" style={{ color: "var(--ck-text)" }}>
                        {c.total_clicks > 0 ? <>{c.total_clicks} <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>({pct(c.total_clicks, c.total_sent)})</span></> : "—"}
                      </td>
                      <td className="px-4 py-3 text-right" style={{ color: c.total_unsubscribes > 0 ? "#f59e0b" : "var(--ck-text-muted)" }}>
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
                            className="rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors hover:opacity-80"
                            style={{ borderColor: "var(--ck-border)", color: "#dc2626", background: "rgba(239,68,68,0.05)" }}
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
  const config: Record<string, { bg: string; text: string; dot: string }> = {
    draft: { bg: "rgba(107,114,128,0.1)", text: "#6b7280", dot: "#6b7280" },
    pending: { bg: "rgba(245,158,11,0.1)", text: "#d97706", dot: "#f59e0b" },
    scheduled: { bg: "rgba(139,92,246,0.1)", text: "#7c3aed", dot: "#8b5cf6" },
    sending: { bg: "rgba(59,130,246,0.1)", text: "#2563eb", dot: "#3b82f6" },
    paused: { bg: "rgba(234,179,8,0.1)", text: "#ca8a04", dot: "#eab308" },
    done: { bg: "rgba(16,185,129,0.1)", text: "#059669", dot: "#10b981" },
    cancelled: { bg: "rgba(239,68,68,0.1)", text: "#dc2626", dot: "#ef4444" },
  };
  const c = config[status] || config.draft;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: c.bg, color: c.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
      {status}
    </span>
  );
}
