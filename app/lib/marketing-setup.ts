export type MarketingSetup = {
  email_service_configured: boolean;
  email_feedback_configured: boolean;
  operator_status: "eligible" | "quiet_hours" | "policy_approval_pending" | "timezone_unavailable";
  welcome_back_available: boolean;
};

export function isMarketingSetup(value: unknown): value is MarketingSetup {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return typeof data.email_service_configured === "boolean"
    && typeof data.email_feedback_configured === "boolean"
    && typeof data.welcome_back_available === "boolean"
    && ["eligible", "quiet_hours", "policy_approval_pending", "timezone_unavailable"].includes(String(data.operator_status));
}

export function marketingSetupSteps(setup: MarketingSetup): string[] {
  const steps: string[] = [];
  if (!setup.email_service_configured) steps.push("BookingTours: connect the email service.");
  if (!setup.email_feedback_configured) steps.push("BookingTours: connect bounced-email and spam reports.");
  if (setup.operator_status === "policy_approval_pending") steps.push("BookingTours: enable marketing emails for this operator.");
  if (setup.operator_status === "timezone_unavailable") steps.push("BookingTours: set this operator’s local time zone.");
  if (!setup.welcome_back_available) steps.push("BookingTours: finish automatic welcome-back emails.");
  return steps;
}

export function marketingSetupEmail(businessName: string, businessId: string, steps: string[]): string {
  const params = new URLSearchParams({
    subject: "Marketing email setup: " + businessName,
    body: `Operator: ${businessName}\nOperator ID: ${businessId}\n\nPlease help with these setup steps:\n${steps.map(step => "- " + step).join("\n")}`,
  });
  return "mailto:support@bookingtours.co.za?" + params.toString();
}
