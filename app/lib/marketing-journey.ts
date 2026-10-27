import { stepSentence, triggerSentence, type AutomationLike, type AutomationStep } from "./automation-copy";

export const MARKETING_CONTRACT_VERSION = 1;
export const marketingReasons: Record<string, string> = {
  eligible: "Marketing permission recorded",
  permission_unknown: "Marketing permission unverified",
  suppressed: "Cannot receive marketing emails: unsubscribed, undeliverable or reported as spam",
  voucher_expiry_schedule_unavailable: "Voucher reminders need verified expiry-based scheduling and contact binding",
  voucher_binding_unavailable: "Voucher-to-contact binding is unavailable",
  voucher_ineligible: "Voucher is unavailable, expired, redeemed or belongs to another recipient",
  promo_ineligible: "Promo is unavailable, expired or its use limit has been reached",
  identity_ambiguous: "Shared email address. Check the contact's identity.",
  already_booked: "Has a non-cancelled reservation, including unpaid",
  rebooked_or_upcoming: "Booked again or has an upcoming reservation",
  frequency_24h: "Marketing email queued or sent in the last 24 hours",
  quiet_hours: "Outside 08:00–20:00 in the operator timezone",
  delivery_reconcile: "Provider outcome needs reconciliation",
};

// Reflect the executable trigger and step data. Never claim review completion,
// delivery, revenue or availability from an open, a click or a synthetic path.
export function journeyContract(automation: AutomationLike, steps: AutomationStep[], timezone: string) {
  return {
    version: MARKETING_CONTRACT_VERSION,
    trigger: triggerSentence(automation),
    eligibility: "Customers with marketing permission, no unsubscribe and no rejected email.",
    goal: automation.trigger_type === "contact_added" ? "Stop on any new reservation, including unpaid."
      : automation.trigger_type === "booking_inactive" ? "Stop on a new or upcoming booking."
      : "Completed reviews cannot be tracked.",
    timing: `Sends within configured local hours. Timezone: ${timezone}.`,
    frequency: "Sending limit covers campaigns and automations.",
    reentry: automation.trigger_type === "date_field" ? "Once a year at most."
      : automation.trigger_type === "booking_inactive" ? "Once per customer's last paid booking."
      : "Once per customer. Review before repeating.",
    stop: "Stop on unsubscribe, failed address or missing permission. Booking messages continue separately.",
    steps: steps.map((s,i) => stepSentence(s,i,steps)),
  };
}

export type SyntheticContact = {
  name: string; permission: "verified" | "unknown" | "suppressed"; reservation?: boolean;
  rebooked?: boolean; completed?: boolean; lapsed?: boolean;
};
export type MarketingGoal = "reviews" | "welcome" | "winback" | "vouchers";
export const marketingGoals: { key: MarketingGoal; title: string; recipe: string; why: string; prerequisite: string }[] = [
  { key: "reviews", title: "Ask for reviews", recipe: "post-tour-review", why: "Ask guests to review their trip.", prerequisite: "Needs a completed trip and review link." },
  { key: "welcome", title: "Welcome new enquiries", recipe: "welcome-series", why: "Introduce your tours to new customers.", prerequisite: "Needs marketing permission and no existing reservation." },
  { key: "winback", title: "Invite customers back", recipe: "win-back", why: "Invite past guests to book again.", prerequisite: "Needs marketing permission, a past paid booking and no new or upcoming reservation." },
  { key: "vouchers", title: "Voucher expiry reminders", recipe: "voucher-expiry", why: "Remind customers before their voucher expires.", prerequisite: "Automatic reminders unavailable. Check vouchers in Vouchers." },
];
export const syntheticMarketingContacts: SyntheticContact[] = [
  { name: "Alex (synthetic)", permission: "verified", completed: true, lapsed: true },
  { name: "Sam (synthetic)", permission: "unknown" },
  { name: "Lee (synthetic)", permission: "suppressed", completed: true },
  { name: "Jo (synthetic)", permission: "verified", reservation: true, rebooked: true, completed: true, lapsed: true },
];
export function simulateMarketingGoal(goal: MarketingGoal, contacts: SyntheticContact[]) {
  return contacts.map(contact => {
    let reason = "eligible";
    if (contact.permission === "suppressed") reason = "suppressed";
    else if (contact.permission !== "verified") reason = "permission_unknown";
    else if (goal === "welcome" && contact.reservation) reason = "already_booked";
    else if (goal === "reviews" && !contact.completed) reason = "Completed-tour event is unavailable";
    else if (goal === "winback" && (contact.rebooked || !contact.lapsed)) reason = "rebooked_or_upcoming";
    else if (goal === "vouchers") reason = "Voucher binding and live eligibility are unavailable";
    return { ...contact, reason, explanation: marketingReasons[reason] || reason };
  });
}
