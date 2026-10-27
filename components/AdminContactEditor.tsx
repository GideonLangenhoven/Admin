"use client";

import { FormEvent, useId, useRef, useState } from "react";
import { getAuthHeaders } from "../app/lib/admin-auth";
import { authStorage } from "../app/lib/browser-session";

type AdminContact = { id: string; name: string | null; email: string; phone?: string | null; must_set_password?: boolean; invite_sent_at?: string | null };

export default function AdminContactEditor({ admin, businessId, disabled = false, onSaved }: {
  admin: AdminContact; businessId: string; disabled?: boolean; onSaved: (admin: AdminContact) => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function close() { setEditing(false); button.current?.focus(); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || disabled) return;
    setSaving(true); setError(""); setMessage("");
    const sessionEmail = authStorage.getItem("ck_admin_email");
    try {
      const response = await fetch("/api/admin/contact", {
        method: "POST", headers: await getAuthHeaders(businessId),
        body: JSON.stringify({ admin_id: admin.id, expected_email: admin.email, name, email, phone }),
      });
      const result = await response.json();
      if (result.admin) {
        if (result.self && authStorage.getItem("ck_admin_email") === sessionEmail) {
          authStorage.setItem("ck_admin_email", result.admin.email);
          authStorage.setItem("ck_admin_name", result.admin.name || "");
          window.dispatchEvent(new Event("ck-admin-contact-updated"));
        }
        onSaved(result.admin);
      }
      if (!response.ok) throw new Error(result.error || "Could not save contact details. Try again.");
      setMessage(result.admin.must_set_password
        ? "Contact saved. Choose Send setup link to email a new link."
        : "Contact details saved.");
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save contact details. Try again.");
    } finally { setSaving(false); }
  }

  return <div className="mt-2">
    <button ref={button} type="button" className="ui-btn ui-btn-ghost !px-3 !text-xs" disabled={disabled || saving}
      aria-expanded={editing} aria-controls={id} onClick={() => {
        if (editing) { close(); return; }
        setName(admin.name || ""); setEmail(admin.email); setPhone(admin.phone || "");
        setError(""); setMessage(""); setEditing(true);
      }}>Edit contact details</button>
    {editing && <form id={id} onSubmit={save} className="mt-3 space-y-3 border-t border-[var(--ck-border-subtle)] pt-4">
      <fieldset disabled={disabled || saving} className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-[var(--ck-text-strong)]" htmlFor={`${id}-name`}>Name
          <input autoFocus id={`${id}-name`} className="ui-control mt-1 w-full px-3 py-2" autoComplete="off" required maxLength={120} value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-[var(--ck-text-strong)]" htmlFor={`${id}-email`}>Email address
          <input id={`${id}-email`} className="ui-control mt-1 w-full px-3 py-2" autoComplete="off" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} aria-describedby={`${id}-email-help`} />
        </label>
        <label className="block text-sm font-medium text-[var(--ck-text-strong)]" htmlFor={`${id}-phone`}>Phone number <span className="font-normal">(optional)</span>
          <input id={`${id}-phone`} className="ui-control mt-1 w-full px-3 py-2" autoComplete="off" type="tel" maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} />
        </label>
      </fieldset>
      <p id={`${id}-email-help`} className="text-sm text-[var(--ck-text-muted)]">Used for sign-in and account emails. Saving a new address expires existing password setup links.</p>
      {error && <p role="alert" className="text-sm text-[var(--ck-danger)]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving || disabled}>{saving ? "Saving…" : "Save contact details"}</button>
        <button type="button" className="ui-btn ui-btn-ghost" disabled={saving} onClick={close}>Cancel</button>
      </div>
    </form>}
    {message && <p role="status" className="mt-2 text-sm text-[var(--ck-text-muted)]">{message}</p>}
  </div>;
}
