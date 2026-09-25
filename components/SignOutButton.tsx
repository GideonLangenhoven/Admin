"use client";

import { useState } from "react";

const PROTECTED_SIGN_OUT_EVENT = "bookingtours:protected-sign-out";

export default function SignOutButton({ variant = "sidebar" }: { variant?: "sidebar" | "header" }) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    setError("");
    const success = await new Promise<boolean>((complete) => {
      const detail = { handled: false, complete };
      window.dispatchEvent(new CustomEvent(PROTECTED_SIGN_OUT_EVENT, { detail }));
      if (!detail.handled) complete(false);
    });
    if (success) {
      window.location.reload();
      return;
    }
    setError("Sign out could not be completed safely. Please try again.");
    setSigningOut(false);
  }

  if (variant === "header") {
    return (
      <div className="flex items-center gap-2">
        {error && <span role="alert" className="text-xs" style={{ color: "var(--ck-danger)" }}>{error}</span>}
        <button
          onClick={logout}
          disabled={signingOut}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50"
          style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-strong)" }}
        >
          {signingOut ? "Signing Out..." : "Sign Out"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={logout}
        disabled={signingOut}
        className="text-left px-4 py-3 text-xs font-medium transition-colors disabled:opacity-50"
        style={{ color: "var(--ck-sidebar-muted)" }}
      >
        {signingOut ? "Signing Out..." : "Sign Out"}
      </button>
      {error && <p role="alert" className="px-4 pb-3 text-xs" style={{ color: "var(--ck-danger)" }}>{error}</p>}
    </div>
  );
}
