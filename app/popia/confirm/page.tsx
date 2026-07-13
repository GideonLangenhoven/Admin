"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BrandMark } from "../../../components/BrandLogo";

function ConfirmContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const id = searchParams.get("id");
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");

  useEffect(() => {
    if (!token || !id) {
      setState("error");
      setMessage("Invalid confirmation link. Please check your email and try again.");
      return;
    }
    confirm();
  }, [token, id]);

  async function confirm() {
    try {
      const r = await fetch("/api/popia/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, id }),
      });
      const data = await r.json();
      if (r.ok) {
        setState("success");
        setScheduledFor(data.scheduled_for);
        setMessage(data.request_type === "DELETION"
          ? "Your deletion request has been confirmed."
          : "Your data request has been confirmed.");
      } else {
        setState("error");
        setMessage(data.error || "Failed to confirm request.");
      }
    } catch {
      setState("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="anim-fade-up w-full max-w-md">
        <div className="ui-card relative overflow-hidden p-8 text-center" style={{ boxShadow: "var(--ck-shadow-lg)" }}>
          <div className="absolute inset-x-0 top-0 h-1.5 bg-bt-gradient" aria-hidden="true" />
          <BrandMark size={44} className="mx-auto mb-5" />

          {state === "loading" && (
            <div className="py-4">
              <div className="ui-skeleton mx-auto h-8 w-8 !rounded-full" />
              <p className="mt-4 text-sm" style={{ color: "var(--ck-text-muted)" }}>Confirming your request…</p>
            </div>
          )}

          {state === "success" && (
            <div className="py-2">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--ck-success-soft)", color: "var(--ck-success)" }}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
              </div>
              <h1 className="font-display text-[22px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{message}</h1>
              {scheduledFor && (
                <p className="mt-3 text-sm" style={{ color: "var(--ck-text-muted)" }}>
                  Your request is scheduled for processing on{" "}
                  <strong style={{ color: "var(--ck-text)" }}>{new Date(scheduledFor).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}</strong>.
                  You have 30 days to cancel if you change your mind.
                </p>
              )}
              <p className="mt-4 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                You can close this page. We&apos;ll email you when your request has been processed.
              </p>
            </div>
          )}

          {state === "error" && (
            <div className="py-2">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </div>
              <h1 className="font-display text-[22px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Confirmation Failed</h1>
              <p className="mt-3 text-sm" style={{ color: "var(--ck-text-muted)" }}>{message}</p>
            </div>
          )}
        </div>
        <p className="ui-mono-label mt-5 text-center !text-[9.5px]">
          Powered by{" "}
          <a href="https://bookingtours.co.za" target="_blank" rel="noopener noreferrer">
            BookingTours
          </a>
        </p>
      </div>
    </div>
  );
}

export default function POPIAConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="ui-skeleton h-8 w-8 !rounded-full" /></div>}>
      <ConfirmContent />
    </Suspense>
  );
}
