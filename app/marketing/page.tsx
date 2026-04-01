"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import { Send, Users, LayoutTemplate, CheckCircle2, Eye, MousePointerClick, UserMinus, AlertTriangle } from "lucide-react";
import Link from "next/link";

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

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string | number; sub?: string; icon: any; color: string }) {
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold" style={{ color: "var(--ck-text-strong)" }}>{value}</p>
          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{label}</p>
          {sub && <p className="text-xs mt-0.5" style={{ color: "var(--ck-text-muted)" }}>{sub}</p>}
        </div>
      </div>
    </div>
  );
}

function pct(num: number, den: number) {
  if (!den) return "0%";
  return (num / den * 100).toFixed(1) + "%";
}

export default function MarketingOverview() {
  var { businessId } = useBusinessContext();
  var [contacts, setContacts] = useState(0);
  var [unsubscribed, setUnsubscribed] = useState(0);
  var [bounced, setBounced] = useState(0);
  var [templates, setTemplates] = useState(0);
  var [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  var [emailsSent, setEmailsSent] = useState(0);
  var [includedEmails, setIncludedEmails] = useState(500);
  var [overageRate, setOverageRate] = useState(0.15);
  var [monthlyUsage, setMonthlyUsage] = useState(0);
  var [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    async function load() {
      var currentPeriod = new Date().toISOString().slice(0, 7);
      var [activeRes, unsubRes, bouncedRes, tRes, campRes, bizRes, usageRes] = await Promise.all([
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
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" /></div>;
  }

  // Aggregate totals across all campaigns
  var totalSent = campaigns.reduce((s, c) => s + (c.total_sent || 0), 0);
  var totalOpens = campaigns.reduce((s, c) => s + (c.total_opens || 0), 0);
  var totalClicks = campaigns.reduce((s, c) => s + (c.total_clicks || 0), 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active Contacts" value={contacts} sub={`${unsubscribed} unsub · ${bounced} bounced`} icon={Users} color="bg-blue-600" />
        <StatCard label="Templates" value={templates} icon={LayoutTemplate} color="bg-purple-600" />
        <StatCard label="Emails Sent" value={emailsSent.toLocaleString()} icon={CheckCircle2} color="bg-emerald-600" />
        <StatCard label="Campaigns" value={campaigns.length} icon={Send} color="bg-amber-600" />
      </div>

      {/* Usage card */}
      <div className="rounded-xl border p-5" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--ck-text-strong)" }}>Email Usage This Month</h3>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="h-3 rounded-full overflow-hidden" style={{ background: "var(--ck-border)" }}>
              <div className="h-full rounded-full transition-all" style={{
                width: Math.min(100, (monthlyUsage / includedEmails) * 100) + "%",
                background: monthlyUsage >= includedEmails ? "#ef4444" : monthlyUsage >= includedEmails * 0.8 ? "#f59e0b" : "var(--ck-accent)"
              }} />
            </div>
            <p className="text-xs mt-1" style={{ color: "var(--ck-text-muted)" }}>
              {monthlyUsage.toLocaleString()} / {includedEmails.toLocaleString()} included emails
            </p>
          </div>
        </div>
        {monthlyUsage >= includedEmails && (
          <div className="mt-3 rounded-lg p-3 text-xs font-medium" style={{ background: "#fef2f2", color: "#dc2626" }}>
            You've exceeded your included emails. Overage: R{overageRate.toFixed(2)}/email — {(monthlyUsage - includedEmails).toLocaleString()} extra emails = R{((monthlyUsage - includedEmails) * overageRate).toFixed(2)}
          </div>
        )}
        {monthlyUsage >= includedEmails * 0.8 && monthlyUsage < includedEmails && (
          <div className="mt-3 rounded-lg p-3 text-xs font-medium" style={{ background: "#fffbeb", color: "#d97706" }}>
            Approaching limit: {((monthlyUsage / includedEmails) * 100).toFixed(0)}% used. Overage rate: R{overageRate.toFixed(2)}/email
          </div>
        )}
      </div>

      {/* Engagement rates */}
      {totalSent > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border p-4 text-center" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
            <Eye size={18} className="mx-auto mb-1 text-blue-500" />
            <p className="text-xl font-bold" style={{ color: "var(--ck-text-strong)" }}>{pct(totalOpens, totalSent)}</p>
            <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Open Rate</p>
          </div>
          <div className="rounded-xl border p-4 text-center" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
            <MousePointerClick size={18} className="mx-auto mb-1 text-emerald-500" />
            <p className="text-xl font-bold" style={{ color: "var(--ck-text-strong)" }}>{pct(totalClicks, totalSent)}</p>
            <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Click Rate</p>
          </div>
          <div className="rounded-xl border p-4 text-center" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
            <UserMinus size={18} className="mx-auto mb-1 text-orange-500" />
            <p className="text-xl font-bold" style={{ color: "var(--ck-text-strong)" }}>{unsubscribed}</p>
            <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Unsubscribes</p>
          </div>
          <div className="rounded-xl border p-4 text-center" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
            <AlertTriangle size={18} className="mx-auto mb-1 text-red-500" />
            <p className="text-xl font-bold" style={{ color: "var(--ck-text-strong)" }}>{bounced}</p>
            <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Bounced</p>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Link href="/marketing/contacts" className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--ck-accent)" }}>
          + Add Contacts
        </Link>
        <Link href="/marketing/templates" className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
          + Create Template
        </Link>
      </div>

      {/* Recent campaigns */}
      <div>
        <h2 className="text-lg font-semibold mb-3" style={{ color: "var(--ck-text-strong)" }}>Recent Campaigns</h2>
        {campaigns.length === 0 ? (
          <div className="rounded-xl border p-8 text-center" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
            <Send size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>No campaigns yet. Create a template, then send your first campaign.</p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--ck-border)" }}>
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr style={{ background: "var(--ck-surface)" }}>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Campaign</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Status</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Sent</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Opens</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Clicks</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Unsub</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-t" style={{ borderColor: "var(--ck-border)" }}>
                    <td className="px-4 py-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{c.name}</td>
                    <td className="px-4 py-3">
                      <CampaignStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-right" style={{ color: "var(--ck-text)" }}>
                      {c.total_sent}/{c.total_recipients}
                      {c.total_failed > 0 && <span className="text-red-500 ml-1">({c.total_failed} failed)</span>}
                    </td>
                    <td className="px-4 py-3 text-right" style={{ color: "var(--ck-text)" }}>
                      {c.total_opens > 0 ? (
                        <span>{c.total_opens} <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>({pct(c.total_opens, c.total_sent)})</span></span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right" style={{ color: "var(--ck-text)" }}>
                      {c.total_clicks > 0 ? (
                        <span>{c.total_clicks} <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>({pct(c.total_clicks, c.total_sent)})</span></span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right" style={{ color: c.total_unsubscribes > 0 ? "var(--ck-warning, #f59e0b)" : "var(--ck-text-muted)" }}>
                      {c.total_unsubscribes || "—"}
                    </td>
                    <td className="px-4 py-3 text-right" style={{ color: "var(--ck-text-muted)" }}>
                      {c.scheduled_at && c.status === "scheduled"
                        ? new Date(c.scheduled_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                        : new Date(c.created_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CampaignStatusBadge({ status }: { status: string }) {
  var styles: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    pending: "bg-amber-100 text-amber-700",
    scheduled: "bg-violet-100 text-violet-700",
    sending: "bg-blue-100 text-blue-700",
    paused: "bg-yellow-100 text-yellow-700",
    done: "bg-emerald-100 text-emerald-700",
    cancelled: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}
