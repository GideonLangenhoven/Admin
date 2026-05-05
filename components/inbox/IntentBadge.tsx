import { INTENT_LABELS, INTENT_COLORS, type ChatIntent } from "@/app/lib/intent-types";

export default function IntentBadge({ intent, size = "sm" }: { intent: string | null; size?: "sm" | "xs" }) {
  if (!intent) return null;
  const label = INTENT_LABELS[intent as ChatIntent] || intent;
  const color = INTENT_COLORS[intent as ChatIntent] || "bg-gray-100 text-gray-600";
  const cls = size === "xs" ? "text-[10px] px-1 py-0.5" : "text-xs px-1.5 py-0.5";
  return <span className={`${cls} rounded font-medium ${color}`}>{label}</span>;
}
