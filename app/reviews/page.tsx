"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import { notify } from "../lib/app-notify";
import { Star } from "@phosphor-icons/react";

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
    const { businessId } = useBusinessContext();
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>("PENDING");
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
        <div className="p-6 max-w-5xl mx-auto">
            <div className="anim-fade-up mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="ui-mono-label mb-2">Customers · Reviews</p>
                    <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Reviews</h1>
                </div>
                <div className="-mx-4 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:overflow-visible sm:px-0">
                    <div className="ui-seg w-max">
                        {STATUSES.map(s => (
                            <button key={s} type="button" className="ui-seg-item" data-active={filter === s} onClick={() => setFilter(s)}>
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="ui-skeleton h-24" />)}</div>
            ) : reviews.length === 0 ? (
                <div className="ui-card">
                    <div className="ui-empty">                        <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No {filter.toLowerCase()} reviews</p>
                        <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>{filter === "PENDING" ? "Submitted reviews awaiting moderation will appear here." : "Reviews with this status will appear here."}</p>
                    </div>
                </div>
            ) : (
                <div className="anim-fade-up anim-d1 space-y-4">
                    {reviews.map(r => (
                        <div key={r.id} className="ui-card p-5">
                            <div className="flex items-start justify-between gap-4">
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
                                    <div className="mt-2 flex items-center gap-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                                        {r.tours?.name && <span>Tour: {r.tours.name}</span>}
                                        {r.submitted_at && <span>{new Date(r.submitted_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}</span>}
                                    </div>
                                </div>
                                <div className="flex gap-2 shrink-0">
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
                </div>
            )}
        </div>
    );
}
