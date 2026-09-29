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

      {mode === "challenge" && (
        <p className="mt-4 max-w-[70ch] text-xs leading-relaxed text-[var(--ck-text-muted)]">
          On the phone used for setup, open the authenticator app that scanned the BookingTours QR code or saved its manual key. Look for a BookingTours entry and enter the current six-digit number shown there. BookingTours cannot tell which app you chose.
        </p>
      )}

      {mode === "enroll" && qrCode && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[160px_1fr] sm:items-center">
          <img src={qrCode} alt="Authenticator setup QR code" className="h-40 w-40 rounded-lg bg-[var(--ck-surface)] p-2" />
          <div className="text-xs leading-relaxed text-[var(--ck-text-muted)]">
            <p>Open Google Authenticator or Microsoft Authenticator on your phone and add an account by scanning this QR code. In Microsoft Authenticator, choose Other account. Confirm BookingTours appears in the app, then enter its current six-digit code below.</p>
            <p className="mt-2">Need an app? <a href="https://support.google.com/accounts/answer/1066447" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[var(--ck-text-strong)]">Google Authenticator</a> or <a href="https://www.microsoft.com/en-us/security/authenticator/mobile-app" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[var(--ck-text-strong)]">Microsoft Authenticator</a>.</p>
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
      {mode === "challenge" && (
        <p className="mt-3 text-xs leading-relaxed text-[var(--ck-text-muted)]">Lost the BookingTours entry? Check <a href="https://support.google.com/accounts/answer/1066447" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[var(--ck-text-strong)]">Google&apos;s transfer guide</a> or <a href="https://support.microsoft.com/en-us/authenticator/restore-account-credentials-from-microsoft-authenticator" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[var(--ck-text-strong)]">Microsoft&apos;s backup recovery guide</a> before changing the app on your phone. If the code cannot be restored, operators can ask a Super Admin for verified MFA recovery. Super Admins cannot reset their own MFA here.</p>
      )}
    </section>
  );
}
