export const CHAT_INTENTS = [
  "BOOKING_QUESTION",
  "BOOKING_MODIFY",
  "REFUND_REQUEST",
  "WEATHER_CONCERN",
  "LOGISTICS",
  "COMPLAINT",
  "MARKETING_OPTOUT",
  "OTHER",
] as const;

export type ChatIntent = typeof CHAT_INTENTS[number];

export const INTENT_LABELS: Record<ChatIntent, string> = {
  BOOKING_QUESTION: "Questions about bookings",
  BOOKING_MODIFY: "Change or reschedule",
  REFUND_REQUEST: "Refund requests",
  WEATHER_CONCERN: "Weather worries",
  LOGISTICS: "Getting there & what to bring",
  COMPLAINT: "Complaints",
  MARKETING_OPTOUT: "Unsubscribe requests",
  OTHER: "Other",
};

export const INTENT_COLORS: Record<ChatIntent, string> = {
  BOOKING_QUESTION: "bg-blue-100 text-blue-700",
  BOOKING_MODIFY: "bg-indigo-100 text-indigo-700",
  REFUND_REQUEST: "bg-red-100 text-red-700",
  WEATHER_CONCERN: "bg-amber-100 text-amber-700",
  LOGISTICS: "bg-emerald-100 text-emerald-700",
  COMPLAINT: "bg-red-100 text-red-700",
  MARKETING_OPTOUT: "bg-gray-100 text-gray-600",
  OTHER: "bg-gray-100 text-gray-600",
};

export const HIGH_PRIORITY_INTENTS: ChatIntent[] = ["REFUND_REQUEST", "COMPLAINT", "WEATHER_CONCERN"];
