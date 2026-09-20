import { expect, it, vi } from "vitest";
import * as guide from "../../app/lib/demo-guide";
import { sourceHandler } from "../helpers/source-handler";

it("grounds the demo assistant in the same feature copy and removes excluded routes from retrieval", async () => {
  const llmText = vi.fn(async () => "Set your reply hours in [WhatsApp Bot Mode](/settings#whatsapp-bot).");
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { settings_permissions: {} } }) };
  const handler = sourceHandler("supabase/functions/admin-help-chat/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => ({ from: () => q, rpc: async () => ({ data: [
        { route: "/reviews", title: "Excluded review instructions", content: "Excluded review content", similarity: 1 },
        { route: "/settings", title: "Settings", content: "Configuration help", similarity: 0.9 },
      ] }) }),
      getAdminAppOrigins: () => ["https://test.invalid"], isAllowedOrigin: () => true,
    },
    "../_shared/auth.ts": { requireAuth: async () => ({ readOnly: true, role: "MAIN_ADMIN", businessId: "demo", userId: "demo-user" }) },
    "../_shared/llm.ts": { llmText, llmAvailable: () => true },
    "../_shared/kb.ts": { embedText: async () => [0, 1] },
    "../_shared/demo-guide.ts": guide,
  });
  const response = await handler(new Request("https://test.invalid", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "What can settings do?", page: "/settings" }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.sources).toEqual([{ title: "Settings", route: "/settings" }]);
  const prompt = (llmText.mock.calls[0] as any)[0].system as string;
  expect(prompt).toContain(guide.DEMO_SETTINGS["tour.last-minute"].operator);
  expect(prompt).toContain(guide.DEMO_SETTINGS["credentials.yoco"].operator);
  expect(prompt).toContain("Never emit fill or submit directives");
  expect(prompt).not.toContain("Excluded review content");
  const directory = prompt.split("Page directory (route : purpose):")[1].split("Verified demo feature notes")[0];
  for (const route of guide.DEMO_HIDDEN_PATHS) expect(directory).not.toContain(route + " :");
});
