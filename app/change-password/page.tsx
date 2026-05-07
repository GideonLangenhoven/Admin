"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  completeAdminPasswordSetup,
  validateAdminSetupToken,
} from "../lib/admin-auth";

function ChangePasswordForm() {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const token = searchParams.get("token") || "";
  const setupEmailParam = searchParams.get("email") || "";
  const setupMode = useMemo(() => mode === "setup" && !!token && !!setupEmailParam, [mode, token, setupEmailParam]);

  const [email, setEmail] = useState(setupEmailParam);
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [tokenChecking, setTokenChecking] = useState(setupMode);
  const [tokenValid, setTokenValid] = useState(false);
  const [setupName, setSetupName] = useState("");
  const [resetEmail, setResetEmail] = useState(setupEmailParam);

  useEffect(() => {
    setEmail(setupEmailParam);
    setResetEmail(setupEmailParam);
  }, [setupEmailParam]);

  useEffect(() => {
    async function validate() {
      if (!setupMode) {
        setTokenChecking(false);
        setTokenValid(false);
        return;
      }

      setTokenChecking(true);
      setError("");
      try {
        const admin = await validateAdminSetupToken(setupEmailParam, token);
        if (!admin) {
          setTokenValid(false);
          setError("This password setup link is invalid or has expired.");
        } else {
          setTokenValid(true);
          setSetupName(admin.name || "");
          setEmail(admin.email);
          setResetEmail(admin.email);
        }
      } catch (validateError) {
        console.error("Failed to validate password setup token:", validateError);
        setTokenValid(false);
        setError("Could not verify this password setup link.");
      }
      setTokenChecking(false);
    }

    validate();
  }, [setupEmailParam, setupMode, token]);

  async function requestResetLink(targetEmail: string) {
    const normalizedEmail = targetEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter an email address first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/setup-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", email: normalizedEmail, reason: "RESET" }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to send the reset link.");
      } else {
        setResetSent(true);
      }
    } catch (resetError) {
      console.error("Failed to send password reset link:", resetError);
      setError("Failed to send the password reset email.");
    }

    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (setupMode) {
      if (!newPass || !confirmPass) {
        return setError("Enter and confirm your new password.");
      }
      if (newPass.length < 8) {
        return setError("New password must be at least 8 characters.");
      }
      if (newPass !== confirmPass) {
        return setError("New passwords do not match.");
      }

      setLoading(true);
      try {
        await completeAdminPasswordSetup(setupEmailParam, token, newPass);
        setSuccess(true);
      } catch (setupError) {
        setError(setupError instanceof Error ? setupError.message : "Failed to create your password.");
      }
      setLoading(false);
      return;
    }

    if (!email || !currentPass || !newPass || !confirmPass) {
      return setError("All fields are required.");
    }
    if (newPass.length < 8) {
      return setError("New password must be at least 8 characters.");
    }
    if (newPass !== confirmPass) {
      return setError("New passwords do not match.");
    }

    setLoading(true);

    try {
      const res = await fetch("/api/admin/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_password",
          email: email.trim().toLowerCase(),
          current_password: currentPass,
          new_password: newPass,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoading(false);
        return setError(data?.error || "Failed to update password.");
      }
    } catch {
      setLoading(false);
      return setError("Failed to update password.");
    }

    setLoading(false);
    setSuccess(true);
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--ck-bg)] px-4">
        <div className="ui-surface-elevated w-full max-w-sm p-8 text-center">
          <h1 className="mb-3 text-xl font-semibold tracking-tight text-[var(--ck-text-strong)]">
            {setupMode ? "Password Created" : "Password Updated"}
          </h1>
          <p className="mb-6 text-sm text-[var(--ck-text-muted)]">
            {setupMode
              ? "Your password has been created successfully. You can now sign in."
              : "Your password has been changed successfully. You can now sign in with your new password."}
          </p>
          <a
            href="/"
            className="inline-block w-full rounded-xl bg-[var(--ck-text-strong)] py-3 text-center text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ck-bg)] px-4">
      <div className="ui-surface-elevated w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <h1 className="mb-1 text-xl font-semibold tracking-tight text-[var(--ck-text-strong)]">
            {setupMode ? "Create Password" : "Change Password"}
          </h1>
          <p className="text-sm text-[var(--ck-text-muted)]">
            {setupMode
              ? `Set a password for your admin account${setupName ? `, ${setupName}` : ""}.`
              : "Enter your current password and choose a new one."}
          </p>
        </div>

        {tokenChecking ? (
          <p className="text-center text-sm text-[var(--ck-text-muted)]">Validating secure link...</p>
        ) : setupMode && !tokenValid ? (
          <div className="space-y-4">
            {error && <p className="text-xs font-medium text-[var(--ck-danger)]">{error}</p>}
            <div className="rounded-xl border border-[var(--ck-border-subtle)] bg-[var(--ck-bg)] p-4">
              <p className="text-sm font-medium text-[var(--ck-text-strong)]">Need a fresh password link?</p>
              <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Enter your admin email and we will send a new password reset link.</p>
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => { setResetEmail(e.target.value); setError(""); }}
                placeholder="Email address"
                autoComplete="email"
                className="ui-control mt-3 w-full px-4 py-3 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => requestResetLink(resetEmail)}
                disabled={loading}
                className="mt-3 w-full rounded-xl bg-[var(--ck-text-strong)] py-3 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:opacity-50"
              >
                {loading ? "Sending..." : "Email New Reset Link"}
              </button>
              {resetSent && <p className="mt-3 text-xs text-emerald-700">A password reset link has been sent.</p>}
            </div>
            <p className="text-center text-xs text-[var(--ck-text-muted)]">
              <a href="/" className="hover:underline">Back to sign in</a>
            </p>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-3">
              {!setupMode && (
                <>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    placeholder="Email address"
                    autoComplete="email"
                    className="ui-control w-full px-4 py-3 text-sm outline-none"
                  />
                  <input
                    type="password"
                    value={currentPass}
                    onChange={(e) => { setCurrentPass(e.target.value); setError(""); }}
                    placeholder="Current password"
                    autoComplete="current-password"
                    className="ui-control w-full px-4 py-3 text-sm outline-none"
                  />
                </>
              )}
              {setupMode && (
                <input
                  type="email"
                  value={email}
                  readOnly
                  className="ui-control w-full cursor-not-allowed px-4 py-3 text-sm outline-none opacity-70"
                />
              )}
              <input
                type="password"
                value={newPass}
                onChange={(e) => { setNewPass(e.target.value); setError(""); }}
                placeholder="New password (min 8 characters)"
                autoComplete="new-password"
                className="ui-control w-full px-4 py-3 text-sm outline-none"
              />
              <input
                type="password"
                value={confirmPass}
                onChange={(e) => { setConfirmPass(e.target.value); setError(""); }}
                placeholder="Confirm new password"
                autoComplete="new-password"
                className="ui-control w-full px-4 py-3 text-sm outline-none"
              />

              {error && <p className="text-xs font-medium text-[var(--ck-danger)]">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[var(--ck-text-strong)] py-3 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:opacity-50"
              >
                {loading
                  ? (setupMode ? "Creating..." : "Updating...")
                  : (setupMode ? "Create Password" : "Change Password")}
              </button>
            </form>

            {!setupMode && (
              <div className="mt-6 border-t border-[var(--ck-border-subtle)] pt-4">
                <p className="text-center text-xs text-[var(--ck-text-muted)]">Forgot your password?</p>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => { setResetEmail(e.target.value); setError(""); }}
                  placeholder="Email a secure reset link"
                  autoComplete="email"
                  className="ui-control mt-3 w-full px-4 py-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => requestResetLink(resetEmail)}
                  disabled={loading}
                  className="mt-3 w-full rounded-xl border border-[var(--ck-border-subtle)] py-3 text-sm font-semibold text-[var(--ck-text-strong)] hover:bg-[var(--ck-bg)] disabled:opacity-50"
                >
                  {loading ? "Sending..." : "Email Reset Link"}
                </button>
                {resetSent && <p className="mt-3 text-xs text-emerald-700">A password reset link has been sent.</p>}
              </div>
            )}

            <p className="mt-4 text-center text-xs text-[var(--ck-text-muted)]">
              <a href="/" className="hover:underline">Back to sign in</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[var(--ck-bg)] px-4">
        <p className="text-center text-sm text-[var(--ck-text-muted)]">Loading...</p>
      </div>
    }>
      <ChangePasswordForm />
    </Suspense>
  );
}
