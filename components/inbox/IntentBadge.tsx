import { INTENT_LABELS, type ChatIntent } from "@/app/lib/intent-types";

// Category tint mapped to the design-system pill vocabulary — keeps intents
// on-token and off the banned indigo/violet family.
const INTENT_PILL: Record<ChatIntent, string> = {
  BOOKING_QUESTION: "ui-pill-ocean",
  BOOKING_MODIFY: "ui-pill-accent",
  REFUND_REQUEST: "ui-pill-danger",
  WEATHER_CONCERN: "ui-pill-amber",
  LOGISTICS: "ui-pill-success",
  COMPLAINT: "ui-pill-danger",
  MARKETING_OPTOUT: "ui-pill-neutral",
  OTHER: "ui-pill-neutral",
};

export default function IntentBadge({ intent, size = "sm" }: { intent: string | null; size?: "sm" | "xs" }) {
  if (!intent) return null;
  const label = INTENT_LABELS[intent as ChatIntent] || intent;
  const pill = INTENT_PILL[intent as ChatIntent] || "ui-pill-neutral";
  const cls = size === "xs" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5";
  return <span className={`inline-flex items-center rounded-md font-medium ${cls} ${pill}`}>{label}</span>;
}
