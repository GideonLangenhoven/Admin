"use client";

import { useState } from "react";
import { getAuthHeaders } from "../app/lib/admin-auth";
import { confirmAction, notify } from "../app/lib/app-notify";

const INTEGRATIONS = {
  wa: { name: "WhatsApp", effect: "WhatsApp messages and bot replies will stop until you save new credentials." },
  yoco: { name: "Yoco live", effect: "Live payment links and payment notifications will stop working until you save new credentials." },
  yoco_test: { name: "Yoco test", effect: "Test payments will stop until you save new test credentials. Your current payment mode will stay unchanged." },
};

export default function RemoveIntegrationButton({ businessId, section, disabled, onRemoved, onBusyChange }: {
  businessId: string;
  section: keyof typeof INTEGRATIONS;
  disabled: boolean;
  onRemoved: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const integration = INTEGRATIONS[section];

  async function remove() {
    if (disabled || removing) return;
    onBusyChange(true);
    try {
      const confirmed = await confirmAction({
        title: `Remove ${integration.name} configuration?`,
        message: `${integration.effect} Bookings and payments stay saved. Add new details afterward.`,
        tone: "warning",
        confirmLabel: "Remove configuration",
      });
      if (confirmed !== true) return;
      setRemoving(true);
      const response = await fetch("/api/credentials", {
        method: "POST",
        headers: await getAuthHeaders(businessId),
        body: JSON.stringify({ business_id: businessId, section, action: "clear" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error || "Removal failed. Try again.");
      onRemoved();
      notify({ title: `${integration.name} configuration removed`, message: "Enter and save new credentials to reconnect.", tone: "success" });
    } catch (error) {
      notify({ title: "Configuration could not be removed", message: error instanceof Error ? error.message : "Try again.", tone: "error" });
    } finally {
      setRemoving(false);
      onBusyChange(false);
    }
  }

  return <button type="button" onClick={remove} disabled={disabled || removing}
    aria-label={`Remove ${integration.name} configuration`}
    className="ui-btn ui-btn-ghost w-full text-[var(--ck-danger)] disabled:opacity-50">
    {removing ? "Removing..." : "Remove configuration"}
  </button>;
}
