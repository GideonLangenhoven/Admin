"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

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
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--ck-bg, #f9fafb)" }}>
      <div className="max-w-md w-full p-6 rounded-xl shadow-sm border" style={{ background: "var(--ck-surface, #fff)", borderColor: "var(--ck-border, #e5e7eb)" }}>
        {state === "loading" && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto" />
            <p className="mt-4 text-sm text-gray-600">Confirming your request...</p>
          </div>
        )}

        {state === "success" && (
          <div className="text-center py-4">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6 text-emerald-600"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">{message}</h1>
            {scheduledFor && (
              <p className="mt-3 text-sm text-gray-600">
                Your request is scheduled for processing on{" "}
                <strong>{new Date(scheduledFor).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}</strong>.
                You have 30 days to cancel if you change your mind.
              </p>
            )}
            <p className="mt-4 text-xs text-gray-500">
              You can close this page. We&apos;ll email you when your request has been processed.
            </p>
          </div>
        )}

        {state === "error" && (
          <div className="text-center py-4">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-6 w-6 text-red-600"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">Confirmation Failed</h1>
            <p className="mt-3 text-sm text-gray-600">{message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function POPIAConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>}>
      <ConfirmContent />
    </Suspense>
  );
}
