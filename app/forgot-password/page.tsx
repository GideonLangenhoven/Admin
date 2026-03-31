"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";
import { sendAdminSetupLink } from "../lib/admin-auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data: admin } = await supabase
        .from("admin_users")
        .select("id, email, name")
        .eq("email", trimmed)
        .maybeSingle();

      // Always show success to avoid email enumeration
      if (admin) {
        await sendAdminSetupLink(admin, "RESET");
      }

      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    }

    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ck-bg)] px-4">
      <div className="ui-surface-elevated w-full max-w-sm p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--ck-text-strong)] mb-1">
          Reset Password
        </h1>
        <p className="mb-6 text-sm ui-text-muted">
          Enter your admin email to receive a password reset link.
        </p>

        {sent ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-sm font-semibold text-emerald-700 mb-2">Check your inbox</p>
            <p className="text-xs text-emerald-600 leading-relaxed">
              If an admin account exists for that email, a secure password reset link has been sent.
            </p>
            <a
              href="/"
              className="mt-4 inline-block text-xs text-[var(--ck-text-muted)] hover:underline"
            >
              Back to Sign In
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              placeholder="Email address"
              autoComplete="email"
              className="ui-control mb-3 w-full px-4 py-3 text-sm outline-none"
              required
            />

            {error && <p className="mb-3 text-xs text-[var(--ck-danger)]">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[var(--ck-text-strong)] py-3 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>

            <p className="mt-4 text-xs text-[var(--ck-text-muted)]">
              <a href="/" className="hover:underline">Back to Sign In</a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
