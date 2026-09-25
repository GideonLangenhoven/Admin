"use client";

export type MfaPanelMode = "checking" | "enroll" | "challenge" | "recovery-pending";

export function MfaSensitiveActionPanel({
  mode,
  actionLabel,
  code,
  qrCode,
  secret,
  error,
  busy,
  onCodeChange,
  onVerify,
  onCancel,
}: {
  mode: MfaPanelMode;
  actionLabel: string;
  code: string;
  qrCode?: string;
  secret?: string;
  error: string;
  busy: boolean;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onCancel: () => void;
}) {
  return (
    <section aria-live="polite" className="rounded-xl border border-[var(--ck-border-strong)] bg-[var(--ck-surface-sunken)] p-4">
      <div className="max-w-[70ch]">
        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">
          {mode === "enroll" ? "Set up an authenticator" : mode === "challenge" ? "Verify with your authenticator" : mode === "recovery-pending" ? "MFA recovery is in progress" : "Checking MFA"}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ck-text-muted)]">
          {mode === "recovery-pending"
            ? "A Super Admin must finish the recovery before this protected setting can change. Continue bookings and ordinary work while it is resolved."
            : `${actionLabel} is protected. Your unsaved values stay on this page while you verify.`}
        </p>
      </div>

      {mode === "enroll" && qrCode && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[160px_1fr] sm:items-center">
          <img src={qrCode} alt="Authenticator setup QR code" className="h-40 w-40 rounded-lg bg-[var(--ck-surface)] p-2" />
          <div className="text-xs leading-relaxed text-[var(--ck-text-muted)]">
            <p>Scan this code with an authenticator app, then enter its six-digit code below.</p>
            {secret && <p className="mt-2 break-all"><span className="font-medium text-[var(--ck-text-strong)]">Manual key:</span> <code>{secret}</code></p>}
          </div>
        </div>
      )}

      {(mode === "enroll" || mode === "challenge") && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1 text-xs font-medium text-[var(--ck-text-muted)]">
            Six-digit authenticator code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="ui-control mt-1 w-full font-mono tracking-[0.2em] sm:max-w-56"
              aria-invalid={Boolean(error)}
            />
          </label>
          <button type="button" onClick={onVerify} disabled={busy || code.length !== 6} className="ui-btn ui-btn-primary disabled:opacity-50">
            {busy ? "Verifying..." : "Verify and continue"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="ui-btn ui-btn-ghost disabled:opacity-50">Cancel</button>
        </div>
      )}

      {mode === "recovery-pending" && (
        <button type="button" onClick={onCancel} className="ui-btn ui-btn-ghost mt-4">Close</button>
      )}
      {error && <p role="alert" className="mt-3 text-xs font-medium text-[var(--ck-danger)]">{error}</p>}
      {(mode === "enroll" || mode === "challenge") && (
        <p className="mt-3 text-xs text-[var(--ck-text-muted)]">Can&apos;t access your authenticator? Ask a Super Admin for verified MFA recovery. Continue bookings and ordinary settings work while recovery is pending.</p>
      )}
    </section>
  );
}
