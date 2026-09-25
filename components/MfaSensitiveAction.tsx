"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../app/lib/supabase";
import { MfaSensitiveActionPanel, type MfaPanelMode } from "./MfaSensitiveActionPanel";

type Status = {
  enrolled: boolean;
  currentLevel: "aal1" | "aal2" | null;
  ready: boolean;
  recoveryState: "none" | "pending" | "partial" | "completed";
  reEnrollRequired: boolean;
};

async function serverStatus(): Promise<Status> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in again before continuing.");
  const response = await fetch("/api/mfa/status", { headers: { Authorization: `Bearer ${session.access_token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error || "MFA status is unavailable.");
  return data as Status;
}

export function useSensitiveActionMfa(disabled = false, scopeKey = "default") {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<MfaPanelMode | null>(null);
  const [actionLabel, setActionLabel] = useState("Continue");
  const [factorId, setFactorId] = useState("");
  const [enrollingFactorId, setEnrollingFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((allowed: boolean) => void) | null>(null);
  const generation = useRef(0);

  async function refresh(expectedGeneration: number) {
    if (disabled || generation.current !== expectedGeneration) return null;
    const next = await serverStatus();
    if (generation.current !== expectedGeneration) return null;
    setStatus(next);
    return next;
  }

  useEffect(() => {
    const currentGeneration = ++generation.current;
    resolver.current?.(false);
    resolver.current = null;
    setStatus(null);
    setMode(null);
    setCode("");
    setFactorId("");
    setEnrollingFactorId("");
    setQrCode("");
    setSecret("");
    setError("");
    setBusy(false);
    if (!disabled) refresh(currentGeneration).catch(() => undefined);
    return () => {
      if (generation.current === currentGeneration) generation.current += 1;
      resolver.current?.(false);
      resolver.current = null;
    };
    // scopeKey intentionally cancels pending checks when the selected actor or
    // business changes, even though MFA belongs to the same browser session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, scopeKey]);

  async function preparePrompt(label: string, current: Status, expectedGeneration: number) {
    if (generation.current !== expectedGeneration) return false;
    setActionLabel(label);
    setCode("");
    setError("");
    if (current.recoveryState === "pending" || current.recoveryState === "partial") {
      setMode("recovery-pending");
      return true;
    }

    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    if (generation.current !== expectedGeneration) return false;
    const verified = factors?.totp?.[0];
    if (verified) {
      setFactorId(verified.id);
      setMode("challenge");
      return true;
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "BookingTours authenticator",
      issuer: "BookingTours",
    });
    if (enrollError || !data || data.type !== "totp") throw enrollError || new Error("Authenticator setup could not start.");
    if (generation.current !== expectedGeneration) return false;
    setFactorId(data.id);
    setEnrollingFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setMode("enroll");
    return true;
  }

  async function requireMfa(label: string) {
    if (disabled) return false;
    const expectedGeneration = generation.current;
    setBusy(true);
    setError("");
    try {
      const current = await refresh(expectedGeneration);
      if (current?.ready) {
        setBusy(false);
        return true;
      }
      if (!current) {
        if (generation.current === expectedGeneration) setBusy(false);
        return false;
      }
      if (!await preparePrompt(label, current, expectedGeneration) || generation.current !== expectedGeneration) {
        if (generation.current === expectedGeneration) setBusy(false);
        return false;
      }
      setBusy(false);
      return await new Promise<boolean>((resolve) => { resolver.current = resolve; });
    } catch (caught) {
      if (generation.current !== expectedGeneration) return false;
      setError(caught instanceof Error ? caught.message : "MFA verification could not start.");
      setMode("challenge");
      setBusy(false);
      return false;
    }
  }

  async function verify() {
    if (!factorId || code.length !== 6) return;
    const expectedGeneration = generation.current;
    setBusy(true);
    setError("");
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (generation.current !== expectedGeneration) return;
    if (verifyError) {
      setError(verifyError.message || "That code was not accepted. Check the current code and try again.");
      setBusy(false);
      return;
    }
    try {
      const current = await refresh(expectedGeneration);
      if (!current?.ready) throw new Error("MFA was verified, but the protected session is not ready yet. Enter a new code and try again.");
      setMode(null);
      setCode("");
      setEnrollingFactorId("");
      resolver.current?.(true);
      resolver.current = null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "MFA status could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const unverified = enrollingFactorId;
    setMode(null);
    setCode("");
    setFactorId("");
    setEnrollingFactorId("");
    setQrCode("");
    setSecret("");
    setError("");
    resolver.current?.(false);
    resolver.current = null;
    if (unverified) await supabase.auth.mfa.unenroll({ factorId: unverified }).catch(() => undefined);
  }

  return {
    status,
    busy,
    requireMfa,
    panel: mode ? (
      <MfaSensitiveActionPanel
        mode={mode}
        actionLabel={actionLabel}
        code={code}
        qrCode={qrCode}
        secret={secret}
        error={error}
        busy={busy}
        onCodeChange={setCode}
        onVerify={verify}
        onCancel={cancel}
      />
    ) : null,
  };
}

export function MfaStatus({ status }: { status: Status | null }) {
  if (!status) return <p className="text-xs text-[var(--ck-text-muted)]">Checking authenticator status...</p>;
  const label = status.recoveryState === "pending" || status.recoveryState === "partial" ? "Recovery pending" : status.ready ? "Authenticator verified" : status.enrolled ? "Authenticator code required" : "Authenticator setup required";
  return <p className="text-xs text-[var(--ck-text-muted)]"><span className="font-medium text-[var(--ck-text-strong)]">MFA:</span> {label}</p>;
}
