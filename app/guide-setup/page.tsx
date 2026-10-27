"use client";
import { Suspense, useContext, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GuideSignInContext } from "@/components/GuideSignInContext";

function GuideSetup() {
  const params = useSearchParams();
  const login = params.get("login") || "", token = params.get("token") || "";
  const auth = useContext(GuideSignInContext);
  const [valid, setValid] = useState(false), [checking, setChecking] = useState(true);
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [createdEmail, setCreatedEmail] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/guide/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "validate", login, token }) })
      .then(async response => { const data = await response.json(); if (active) { setValid(response.ok); if (!response.ok) setError(data.error); } })
      .catch(() => { if (active) setError("Could not verify this link. Refresh to try again."); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [login, token]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    if (password !== confirmation) { setError("The passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      let email = createdEmail;
      if (!email) {
        const response = await fetch("/api/guide/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "complete", login, token, password }) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        email = data.email; setCreatedEmail(email);
      }
      if (!auth) throw new Error("Sign-in is unavailable. Open Simple View and sign in with your new password.");
      await auth.signIn(email, password);
    } catch (err) { setError(err instanceof Error ? err.message : "Guide setup failed. Try again."); }
    setBusy(false);
  }
  return <main className="mx-auto flex min-h-screen max-w-md items-center px-4"><section className="ui-card w-full p-6">
    <h1 className="text-2xl font-semibold">Set your guide password</h1>
    <p className="mt-2 break-all text-sm">{login}</p>
    <p className="mt-2 text-sm ui-text-muted">Shared operator login for Simple View and trip photos.</p>
    {createdEmail && <p role="status" className="mt-3 text-sm">Password saved. Sign in to continue.</p>}
    {checking ? <p role="status" className="mt-4">Checking setup link…</p> : valid && <form onSubmit={submit} className="mt-5 space-y-4">
      <label className="block text-sm">Password<input className="ui-control mt-1 min-h-11 w-full px-3" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label className="block text-sm">Confirm password<input className="ui-control mt-1 min-h-11 w-full px-3" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
      <p className="text-xs ui-text-muted">Use at least 8 characters.</p>
      <button className="ui-btn ui-btn-primary min-h-11 w-full" disabled={busy}>{busy ? "Opening Simple View…" : createdEmail ? "Sign in" : "Set password"}</button>
    </form>}
    {(error || auth?.error) && <p role="alert" className="mt-4 text-sm">{error || auth?.error}</p>}
    {!checking && !valid && <p className="mt-3 text-sm">Ask your operator for a fresh private setup link.</p>}
  </section></main>;
}
export default function GuideSetupPage() { return <Suspense><GuideSetup /></Suspense>; }
