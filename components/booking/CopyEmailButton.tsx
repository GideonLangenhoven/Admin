"use client";

import { Clipboard } from "@phosphor-icons/react";
import type { MouseEvent } from "react";
import { notify } from "../../app/lib/app-notify";

export default function CopyEmailButton({ email }: { email?: string | null }) {
  const address = email?.trim() || "";
  if (!address) return null;

  async function copyEmail(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      notify({ title: "Email copied", message: address, tone: "success" });
    } catch {
      notify({ title: "Could not copy email", message: "Select the email address and copy it manually.", tone: "warning" });
    }
  }

  return (
    <button
      type="button"
      aria-label="Copy email address"
      title="Copy email address"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--ck-text-muted)] transition-colors hover:text-[var(--ck-text-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ck-accent)]"
      onClick={copyEmail}
    >
      <Clipboard size={12} aria-hidden="true" />
    </button>
  );
}
