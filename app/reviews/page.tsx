"use client";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import { notify } from "../lib/app-notify";

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

    function stars(n: number | null) {
        if (!n) return "—";
        return "★".repeat(n) + "☆".repeat(5 - n);
    }

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-[var(--ck-text-strong)]">Reviews</h1>
                <div className="flex gap-2">
                    {STATUSES.map(s => (
                        <button key={s} onClick={() => setFilter(s)}
                            className={"px-3 py-1.5 rounded-full text-xs font-semibold transition-colors " +
                                (filter === s ? "bg-[var(--ck-text-strong)] text-[var(--ck-btn-primary-text)]" : "bg-[var(--ck-bg-subtle)] text-[var(--ck-text-muted)] hover:bg-[var(--ck-border-subtle)]")}>
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-[var(--ck-bg-subtle)] rounded-xl animate-pulse" />)}</div>
            ) : reviews.length === 0 ? (
                <div className="text-center py-16 text-[var(--ck-text-muted)]">
                    <p className="text-lg font-semibold">No {filter.toLowerCase()} reviews</p>
                    <p className="text-sm mt-1">{filter === "PENDING" ? "Submitted reviews awaiting moderation will appear here." : "Reviews with this status will appear here."}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {reviews.map(r => (
                        <div key={r.id} className="bg-[var(--ck-bg)] border border-[var(--ck-border-subtle)] rounded-xl p-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3 mb-2">
                                        {r.reviewer_avatar_url && (
                                            <img src={r.reviewer_avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                                        )}
                                        <div>
                                            <span className="font-semibold text-[var(--ck-text-strong)] text-sm">{r.reviewer_name || "Anonymous"}</span>
                                            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-[var(--ck-bg-subtle)] text-[var(--ck-text-muted)]">{r.source}</span>
                                        </div>
                                    </div>
                                    <div className="text-amber-500 text-sm mb-1">{stars(r.rating)}</div>
                                    {r.comment && <p className="text-sm text-[var(--ck-text)] leading-relaxed">{r.comment}</p>}
                                    <div className="flex items-center gap-3 mt-2 text-xs text-[var(--ck-text-muted)]">
                                        {r.tours?.name && <span>Tour: {r.tours.name}</span>}
                                        {r.submitted_at && <span>{new Date(r.submitted_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}</span>}
                                    </div>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    {filter !== "APPROVED" && (
                                        <button onClick={() => updateStatus(r.id, "APPROVED")} disabled={updating === r.id}
                                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 transition-colors">
                                            Approve
                                        </button>
                                    )}
                                    {filter !== "HIDDEN" && (
                                        <button onClick={() => updateStatus(r.id, "HIDDEN")} disabled={updating === r.id}
                                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors">
                                            Hide
                                        </button>
                                    )}
                                    {filter !== "SPAM" && (
                                        <button onClick={() => updateStatus(r.id, "SPAM")} disabled={updating === r.id}
                                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 transition-colors">
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
