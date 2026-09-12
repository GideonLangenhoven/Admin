import { issueCustomerSession, verifyCustomerSession } from "./customer-session.ts";

// A separate claim namespace reuses the existing signed, expiring capability.
// Visitor IDs alone and customer phone numbers never authorize chat history.
const VISITOR = /^web-chat:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

export async function verifyWebChatSession(token: string, businessId: string): Promise<string | null> {
  const session = await verifyCustomerSession(token);
  if (!session.valid || session.businessId !== businessId) return null;
  return VISITOR.exec(session.email || "")?.[1] || null;
}

export async function issueWebChatSession(businessId: string) {
  return issueCustomerSession({ email: "web-chat:" + crypto.randomUUID(), businessId });
}
