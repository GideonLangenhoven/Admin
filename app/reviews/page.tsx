"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import { notify } from "../lib/app-notify";
import { Star } from "@phosphor-icons/react";
import ReportsLayout from "../../components/ReportsLayout";
import ReportPeriodGroup, { ReportPeriodPicker } from "../../components/ReportPeriodGroup";
import { groupReportRows, type ReportPeriod } from "../lib/report-booking-periods";

type Review = {
    id: string;
    source: string;
    status: string;
    rating: number | null;
    comment: string | null;
    reviewer_name: string | null;
    reviewer_avatar_url: string | null;
    tour_id: string | null;
    booking_id: string | null;
    submitted_at: string | null;
    created_at: string;
    tours?: { name: string } | null;
};

const STATUSES = ["PENDING", "APPROVED", "HIDDEN", "SPAM"] as const;

export default function ReviewsPage() {
    const { businessId, timezone } = useBusinessContext();
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>("PENDING");
    const [period, setPeriod] = useState<ReportPeriod>("week");
    const [updating, setUpdating] = useState<string | null>(null);

    useEffect(() => {
        if (!businessId) return;
        loadReviews();
    }, [businessId, filter]);

    async function loadReviews() {
        setLoading(true);
        let q = supabase.from("reviews")
            .select("*, tours(name)")
            .eq("business_id", businessId)
            .eq("status", filter)
            .order("created_at", { ascending: false })
            .limit(100);
        if (filter === "PENDING") q = q.not("submitted_at", "is", null);
        const { data } = await q;
        setReviews((data || []) as Review[]);
        setLoading(false);
    }

    async function updateStatus(id: string, status: string) {
        setUpdating(id);
        const { error } = await supabase.from("reviews").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) {
            notify({ message: "Failed to update: " + error.message, tone: "error" });
        } else {
            notify({ message: "Review " + status.toLowerCase(), tone: "success" });
            setReviews(reviews.filter(r => r.id !== id));
        }
        setUpdating(null);
    }

    return (
        <ReportsLayout activeTab="reviews" description="Approve reviews to publish on your booking site.">
            <div className="ui-card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Reviews</h2>
                <div className="max-w-full overflow-x-auto no-scrollbar">
                    <div className="ui-seg w-max" role="group" aria-label="Review status">
                        {STATUSES.map(s => (
                            <button key={s} type="button" className="ui-seg-item" data-active={filter === s} aria-pressed={filter === s} onClick={() => setFilter(s)}>
                                {s[0] + s.slice(1).toLowerCase()}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <ReportPeriodPicker value={period} onChange={setPeriod} label="Group reviews by" />

            {loading ? (
                <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="ui-skeleton h-24" />)}</div>
            ) : reviews.length === 0 ? (
                <div className="ui-card">
                    <div className="ui-empty">                        <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No {filter.toLowerCase()} reviews</p>
                        <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>{filter === "PENDING" ? "New reviews appear here for approval." : "Try another status."}</p>
                    </div>
                </div>
            ) : (
                <div className="anim-fade-up anim-d1 space-y-4">
                    {groupReportRows(reviews, period, timezone || "UTC", r => r.submitted_at || r.created_at).reverse().map(group => (
                      <ReportPeriodGroup key={`${filter}:${period}:${group.key}`} label={group.label} summary={`${group.rows.length} ${group.rows.length === 1 ? "review" : "reviews"}`}>
                    {group.rows.map(r => (
                        <div key={r.id} className="border-t p-4 sm:p-5">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 mb-2">
                                        {r.reviewer_avatar_url && (
                                            <img src={r.reviewer_avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                                        )}
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{r.reviewer_name || "Anonymous"}</span>
                                            <span className="ui-status ui-pill-neutral">{r.source}</span>
                                        </div>
                                    </div>
                                    <div className="mb-1 flex items-center gap-0.5">
                                        {r.rating ? Array.from({ length: 5 }).map((_, i) => (
                                            <Star key={i} size={14} weight={i < r.rating! ? "fill" : "regular"} style={{ color: i < r.rating! ? "var(--ck-amber)" : "var(--ck-border-strong)" }} />
                                        )) : <span className="text-sm" style={{ color: "var(--ck-text-muted)" }}>—</span>}
                                    </div>
                                    {r.comment && <p className="text-sm leading-relaxed" style={{ color: "var(--ck-text)" }}>{r.comment}</p>}
                                    <div className="mt-2 flex items-center gap-3 text-xs flex-wrap" style={{ color: "var(--ck-text-muted)" }}>
                                        {r.tours?.name && <span>Tour: {r.tours.name}</span>}
                                        {r.submitted_at && <span>{new Date(r.submitted_at).toLocaleDateString("en-ZA", { timeZone: timezone || "UTC", day: "numeric", month: "short", year: "numeric" })}</span>}
                                    </div>
                                </div>
                                <div className="flex gap-2 shrink-0 self-start sm:self-auto flex-wrap">
                                    {filter !== "APPROVED" && (
                                        <button onClick={() => updateStatus(r.id, "APPROVED")} disabled={updating === r.id}
                                            className="ui-btn h-8 px-3 text-xs disabled:opacity-40" style={{ background: "var(--ck-success-soft)", color: "var(--ck-success)" }}>
                                            Approve
                                        </button>
                                    )}
                                    {filter !== "HIDDEN" && (
                                        <button onClick={() => updateStatus(r.id, "HIDDEN")} disabled={updating === r.id}
                                            className="ui-btn ui-btn-ghost h-8 px-3 text-xs disabled:opacity-40">
                                            Hide
                                        </button>
                                    )}
                                    {filter !== "SPAM" && (
                                        <button onClick={() => updateStatus(r.id, "SPAM")} disabled={updating === r.id}
                                            className="ui-btn ui-btn-danger h-8 px-3 text-xs disabled:opacity-40">
                                            Spam
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                      </ReportPeriodGroup>
                    ))}
                </div>
            )}
        </ReportsLayout>
    );
}
