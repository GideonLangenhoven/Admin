"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getAuthHeaders } from "@/app/lib/admin-auth";
import { isMarketingSetup, marketingSetupEmail, marketingSetupSteps, type MarketingSetup } from "@/app/lib/marketing-setup";
import { useBusinessContext } from "@/components/BusinessContext";

export default function MarketingSetupNotice() {
  const { businessId, businessName } = useBusinessContext();
  const [result, setResult] = useState<{ businessId: string; setup?: MarketingSetup; error?: string }>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!businessId) return () => controller.abort();
    getAuthHeaders(businessId).then(headers => fetch("/api/marketing/setup", { headers, signal: controller.signal }))
      .then(async response => {
        const data: unknown = await response.json();
        if (!response.ok || !isMarketingSetup(data)) throw new Error("Email setup could not be checked.");
        if (!controller.signal.aborted) setResult({ businessId, setup: data });
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ businessId, error: "Email setup could not be checked." });
      });
    return () => controller.abort();
  }, [businessId, reload]);
  const current = result?.businessId === businessId ? result : undefined;
  const setup = current?.setup;
  const steps = setup ? marketingSetupSteps(setup) : [];
  if (setup && steps.length === 0) return null;
  return <section className="ui-card space-y-3 p-4" aria-label="Email sending setup">
    {!current ? <p role="status" className="text-sm ui-text-muted">Checking email setup…</p> : current.error ? <>
      <p role="alert" className="text-sm">{current.error}</p>
      <button type="button" className="ui-btn ui-btn-soft min-h-11" onClick={() => { setResult(undefined); setReload(value => value + 1); }}>Check again</button>
    </> : <>
      <p className="font-semibold">{!setup?.welcome_back_available && setup?.email_service_configured && setup.email_feedback_configured && ["eligible", "quiet_hours"].includes(setup.operator_status) ? "Welcome-back emails unavailable" : "Marketing emails need setup"}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm ui-text-muted">{steps.map(step => <li key={step}>{step}</li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <Link className="ui-btn ui-btn-soft min-h-11" href="/marketing/contacts">Review contacts</Link>
        <a className="ui-btn ui-btn-primary min-h-11" href={marketingSetupEmail(businessName, businessId, steps)}>Email BookingTours</a>
      </div>
    </>}
  </section>;
}
