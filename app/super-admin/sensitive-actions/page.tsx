"use client";

import { useEffect, useState } from "react";
import { useBusinessContext } from "../../../components/BusinessContext";
import { MfaStatus, useSensitiveActionMfa } from "../../../components/MfaSensitiveAction";
import { getAuthHeaders } from "../../lib/admin-auth";
import { notify } from "../../lib/app-notify";
import { supabase } from "../../lib/supabase";

type Business = { id: string; business_name: string; subscription_status: string };
type RecoveryAdmin = {
  id: string; name: string | null; email: string; role: string; suspended: boolean;
  readOnly: boolean; authLinked: boolean; recoveryState: string;
};

const EMPTY_BANK = { account_owner: "", account_number: "", account_type: "", bank_name: "", branch_code: "" };
const EMPTY_WA = { token: "", phoneId: "" };
const EMPTY_YOCO = { secretKey: "", webhookSecret: "" };

export default function SensitiveActionsSupportPage() {
  const { role, readOnly } = useBusinessContext();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const mfa = useSensitiveActionMfa(Boolean(readOnly) || role !== "SUPER_ADMIN", `support:${businessId}`);
  const [bank, setBank] = useState(EMPTY_BANK);
  const [wa, setWa] = useState(EMPTY_WA);
  const [yoco, setYoco] = useState(EMPTY_YOCO);
  const [yocoTest, setYocoTest] = useState(EMPTY_YOCO);
  const [testMode, setTestMode] = useState(false);
  const [admins, setAdmins] = useState<RecoveryAdmin[]>([]);
  const [targetAdminId, setTargetAdminId] = useState("");
  const [verificationReference, setVerificationReference] = useState("");
  const [verificationAcknowledged, setVerificationAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");

  useEffect(() => {
    if (role !== "SUPER_ADMIN" || readOnly) return;
    supabase.from("businesses")
      .select("id, business_name, subscription_status")
      .order("business_name")
      .then(({ data, error }) => {
        if (error) notify({ title: "Businesses unavailable", message: error.message, tone: "error" });
        else setBusinesses((data || []) as Business[]);
      });
  }, [role, readOnly]);

  useEffect(() => {
    setBank(EMPTY_BANK);
    setWa(EMPTY_WA);
    setYoco(EMPTY_YOCO);
    setYocoTest(EMPTY_YOCO);
    setAdmins([]);
    setTargetAdminId("");
    setVerificationReference("");
    setVerificationAcknowledged(false);
    if (!businessId) return;
    let current = true;
    setLoading(true);
    (async () => {
      try {
        const headers = await getAuthHeaders(businessId);
        const [bankResult, credentialsResponse, recoveryResponse] = await Promise.all([
          supabase.functions.invoke("bank-details", {
            body: { action: "get", business_id: businessId },
            headers: { "x-admin-business-id": businessId },
          }),
          fetch(`/api/credentials?business_id=${encodeURIComponent(businessId)}`, { headers }),
          fetch(`/api/mfa/recovery?business_id=${encodeURIComponent(businessId)}`, { headers }),
        ]);
        const credentialData = await credentialsResponse.json().catch(() => ({}));
        const recoveryData = await recoveryResponse.json().catch(() => ({}));
        if (bankResult.error || bankResult.data?.error) throw new Error(bankResult.error?.message || bankResult.data?.error);
        if (!credentialsResponse.ok) throw new Error(credentialData.error || "Credential status could not be loaded");
        if (!recoveryResponse.ok) throw new Error(recoveryData.error || "Recovery status could not be loaded");
        if (!current) return;
        setBank({
          account_owner: bankResult.data?.account_owner || "",
          account_number: bankResult.data?.account_number || "",
          account_type: bankResult.data?.account_type || "",
          bank_name: bankResult.data?.bank_name || "",
          branch_code: bankResult.data?.branch_code || "",
        });
        setTestMode(credentialData.yoco_test_mode === true);
        setAdmins(recoveryData.admins || []);
      } catch (error) {
        if (current) notify({ title: "Target could not be loaded", message: error instanceof Error ? error.message : "Try again.", tone: "error" });
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => { current = false; };
  }, [businessId]);

  const selectedBusiness = businesses.find((business) => business.id === businessId);
  const activeTarget = selectedBusiness && ["ACTIVE", "TRIAL", "PAST_DUE"].includes(selectedBusiness.subscription_status);

  async function saveBank() {
    if (!businessId || !await mfa.requireMfa("Save this operator's banking details")) return;
    setSaving("bank");
    const { data, error } = await supabase.functions.invoke("bank-details", {
      body: { action: "set", business_id: businessId, ...bank },
      headers: { "x-admin-business-id": businessId },
    });
    if (error || data?.error) notify({ title: "Bank details unchanged", message: error?.message || data?.error, tone: "error" });
    else notify({ title: "Bank details saved", message: `Updated for ${selectedBusiness?.business_name}.`, tone: "success" });
    setSaving("");
  }

  async function saveCredentials(section: "wa" | "yoco" | "yoco_test" | "yoco_test_mode") {
    if (!businessId || !await mfa.requireMfa(`Save this operator's ${section === "wa" ? "WhatsApp" : "Yoco"} settings`)) return;
    setSaving(section);
    const payload = section === "wa"
      ? { business_id: businessId, section, wa_token: wa.token, wa_phone_id: wa.phoneId }
      : section === "yoco"
        ? { business_id: businessId, section, yoco_secret_key: yoco.secretKey, yoco_webhook_secret: yoco.webhookSecret }
        : section === "yoco_test"
          ? { business_id: businessId, section, yoco_test_secret_key: yocoTest.secretKey, yoco_test_webhook_secret: yocoTest.webhookSecret }
          : { business_id: businessId, section, yoco_test_mode: !testMode };
    try {
      const response = await fetch("/api/credentials", { method: "POST", headers: await getAuthHeaders(businessId), body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Settings were not saved");
      if (section === "wa") setWa(EMPTY_WA);
      if (section === "yoco") setYoco(EMPTY_YOCO);
      if (section === "yoco_test") setYocoTest(EMPTY_YOCO);
      if (section === "yoco_test_mode") setTestMode((value) => !value);
      notify({ title: "Integration settings saved", message: `Updated for ${selectedBusiness?.business_name}.`, tone: "success" });
    } catch (error) {
      notify({ title: "Integration settings unchanged", message: error instanceof Error ? error.message : "Try again.", tone: "error" });
    }
    setSaving("");
  }

  async function recoverMfa() {
    if (!businessId || !targetAdminId || !await mfa.requireMfa("Complete verified MFA recovery")) return;
    setSaving("recovery");
    try {
      const response = await fetch("/api/mfa/recovery", {
        method: "POST",
        headers: await getAuthHeaders(businessId),
        body: JSON.stringify({
          business_id: businessId,
          admin_id: targetAdminId,
          verification_acknowledged: verificationAcknowledged,
          verification_reference: verificationReference,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Recovery did not complete");
      setAdmins((rows) => rows.map((admin) => admin.id === targetAdminId ? { ...admin, recoveryState: "completed" } : admin));
      setVerificationAcknowledged(false);
      setVerificationReference("");
      notify({ title: "MFA recovery completed", message: "The administrator must sign in and enroll a new authenticator.", tone: "success" });
    } catch (error) {
      notify({ title: "Recovery needs attention", message: error instanceof Error ? error.message : "Refresh the target and retry.", tone: "error" });
    }
    setSaving("");
  }

  if (role !== "SUPER_ADMIN" || readOnly) {
    return <div className="ui-card max-w-2xl p-6"><h1 className="text-xl font-semibold text-[var(--ck-text-strong)]">Sensitive settings support</h1><p className="mt-2 text-sm text-[var(--ck-text-muted)]">An active Super Admin account is required.</p></div>;
  }

  return (
    <main className="max-w-5xl space-y-6">
      <div>
        <a href="/super-admin" className="text-xs font-medium text-[var(--ck-accent)] hover:underline">Back to Super Admin</a>
        <h1 className="font-display mt-2 text-[28px] font-semibold text-[var(--ck-text-strong)]">Sensitive settings support</h1>
        <p className="mt-2 max-w-[70ch] text-sm text-[var(--ck-text-muted)]">Select the operator explicitly. Changes use your signed-in identity and authenticator, and the audit trail records you as the actor.</p>
      </div>

      <section className="ui-card p-5">
        <label className="block text-xs font-semibold text-[var(--ck-text-muted)]" htmlFor="support-business">Operator business</label>
        <select id="support-business" value={businessId} onChange={(event) => setBusinessId(event.target.value)} className="ui-control mt-2 w-full md:max-w-xl">
          <option value="">Select a business</option>
          {businesses.map((business) => <option key={business.id} value={business.id}>{business.business_name} ({business.subscription_status})</option>)}
        </select>
        {selectedBusiness && !activeTarget && <p role="alert" className="mt-2 text-xs font-medium text-[var(--ck-danger)]">This business is not active, so protected settings cannot change.</p>}
      </section>

      {businessId && <>
        <section className="ui-card space-y-3 p-5">
          <MfaStatus status={mfa.status} />
          {mfa.panel}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="ui-card space-y-4 p-5">
            <div><h2 className="text-lg font-semibold text-[var(--ck-text-strong)]">Invoice banking details</h2><p className="mt-1 text-xs text-[var(--ck-text-muted)]">Encrypted and attributed to your Super Admin account.</p></div>
            {Object.entries(bank).map(([key, value]) => <label key={key} className="block text-xs font-medium capitalize text-[var(--ck-text-muted)]">{key.replaceAll("_", " ")}<input value={value} onChange={(event) => setBank((current) => ({ ...current, [key]: event.target.value }))} className="ui-control mt-1 w-full" /></label>)}
            <button type="button" onClick={saveBank} disabled={!activeTarget || loading || Boolean(saving) || mfa.busy} className="ui-btn ui-btn-primary disabled:opacity-50">{saving === "bank" ? "Saving..." : "Save bank details"}</button>
          </section>

          <section className="ui-card space-y-5 p-5">
            <div><h2 className="text-lg font-semibold text-[var(--ck-text-strong)]">Integration credentials</h2><p className="mt-1 text-xs text-[var(--ck-text-muted)]">Values clear from this form after a successful save.</p></div>
            <CredentialPair title="WhatsApp" firstLabel="Access token" secondLabel="Phone number ID" value={wa} firstKey="token" secondKey="phoneId" setValue={setWa} />
            <button type="button" onClick={() => saveCredentials("wa")} disabled={!activeTarget || Boolean(saving) || mfa.busy || !wa.token || !wa.phoneId} className="ui-btn ui-btn-primary disabled:opacity-50">{saving === "wa" ? "Saving..." : "Save WhatsApp"}</button>
            <CredentialPair title="Yoco live" firstLabel="Secret key" secondLabel="Webhook signing secret" value={yoco} firstKey="secretKey" secondKey="webhookSecret" setValue={setYoco} />
            <button type="button" onClick={() => saveCredentials("yoco")} disabled={!activeTarget || Boolean(saving) || mfa.busy || !yoco.secretKey || !yoco.webhookSecret} className="ui-btn ui-btn-primary disabled:opacity-50">{saving === "yoco" ? "Saving..." : "Save Yoco live"}</button>
            <CredentialPair title="Yoco test" firstLabel="Test secret key" secondLabel="Test webhook secret" value={yocoTest} firstKey="secretKey" secondKey="webhookSecret" setValue={setYocoTest} />
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => saveCredentials("yoco_test")} disabled={!activeTarget || Boolean(saving) || mfa.busy || !yocoTest.secretKey || !yocoTest.webhookSecret} className="ui-btn ui-btn-primary disabled:opacity-50">{saving === "yoco_test" ? "Saving..." : "Save Yoco test"}</button><button type="button" onClick={() => saveCredentials("yoco_test_mode")} disabled={!activeTarget || Boolean(saving) || mfa.busy} className="ui-btn ui-btn-ghost disabled:opacity-50">{testMode ? "Use live mode" : "Use test mode"}</button></div>
          </section>
        </div>

        <section className="ui-card space-y-4 p-5">
          <div><h2 className="text-lg font-semibold text-[var(--ck-text-strong)]">Verified MFA recovery</h2><p className="mt-1 max-w-[70ch] text-xs text-[var(--ck-text-muted)]">Use this only after verifying the administrator through the approved support procedure. Factor identifiers and credentials are never written to the audit log.</p></div>
          <label className="block text-xs font-medium text-[var(--ck-text-muted)]">Administrator<select value={targetAdminId} onChange={(event) => setTargetAdminId(event.target.value)} className="ui-control mt-1 w-full md:max-w-xl"><option value="">Select an administrator</option>{admins.map((admin) => <option key={admin.id} value={admin.id} disabled={admin.suspended || admin.readOnly || !admin.authLinked}>{admin.name || admin.email} ({admin.role}, recovery: {admin.recoveryState})</option>)}</select></label>
          <label className="block text-xs font-medium text-[var(--ck-text-muted)]">Verification ticket or call reference<input value={verificationReference} onChange={(event) => setVerificationReference(event.target.value.replace(/[^A-Za-z0-9._:/#-]/g, "").slice(0, 120))} placeholder="SUPPORT-12345" className="ui-control mt-1 w-full md:max-w-xl" /></label>
          <label className="flex max-w-[70ch] items-start gap-3 text-sm text-[var(--ck-text)]"><input type="checkbox" checked={verificationAcknowledged} onChange={(event) => setVerificationAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--ck-accent)]" /><span>I verified this administrator’s identity through the approved support procedure and recorded the reference above.</span></label>
          <button type="button" onClick={recoverMfa} disabled={!activeTarget || !targetAdminId || !verificationAcknowledged || verificationReference.length < 5 || Boolean(saving) || mfa.busy} className="ui-btn ui-btn-primary disabled:opacity-50">{saving === "recovery" ? "Processing recovery..." : "Remove MFA factors"}</button>
        </section>
      </>}
    </main>
  );
}

function CredentialPair({ title, firstLabel, secondLabel, value, firstKey, secondKey, setValue }: {
  title: string; firstLabel: string; secondLabel: string; value: Record<string, string>;
  firstKey: string; secondKey: string; setValue: React.Dispatch<React.SetStateAction<any>>;
}) {
  return <fieldset className="space-y-3 border-t border-[var(--ck-border-subtle)] pt-4"><legend className="pr-2 text-sm font-semibold text-[var(--ck-text-strong)]">{title}</legend><label className="block text-xs font-medium text-[var(--ck-text-muted)]">{firstLabel}<input type="password" autoComplete="new-password" value={value[firstKey]} onChange={(event) => setValue((current: any) => ({ ...current, [firstKey]: event.target.value }))} className="ui-control mt-1 w-full" /></label><label className="block text-xs font-medium text-[var(--ck-text-muted)]">{secondLabel}<input type="password" autoComplete="new-password" value={value[secondKey]} onChange={(event) => setValue((current: any) => ({ ...current, [secondKey]: event.target.value }))} className="ui-control mt-1 w-full" /></label></fieldset>;
}
