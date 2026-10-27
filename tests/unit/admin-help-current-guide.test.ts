import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import * as guide from "../../app/lib/demo-guide";
import { sourceHandler } from "../helpers/source-handler";

it("every help article and internal link points to an existing dashboard page", () => {
  for (const file of readdirSync("docs/admin-help").filter(file => file.endsWith(".md"))) {
    const article = readFileSync(join("docs/admin-help", file), "utf8");
    const route = article.match(/^route:\s*(\S+)/m)?.[1];
    expect(route, file).toBeDefined();
    const routes = [route!, ...[...article.matchAll(/\]\((\/[^)]+)\)/g)].map(match => match[1])];
    for (const href of routes) {
      const path = href.split(/[?#]/)[0];
      expect(existsSync(join("app", path, "page.tsx")), `${file}: ${href}`).toBe(true);
    }
  }
});

it("uses the current page map and permissions when retrieval misses, even with stale history", async () => {
  const llmText = vi.fn(async () => "Open the full dashboard and choose Simple View.");
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { settings_permissions: { site: true, invoice: true } } }) };
  const handler = sourceHandler("supabase/functions/admin-help-chat/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => ({ from: () => q, rpc: async () => ({ data: [] }) }),
      getAdminAppOrigins: () => ["https://test.invalid"], isAllowedOrigin: () => true,
    },
    "../_shared/auth.ts": { requireAuth: async () => ({ readOnly: false, role: "ADMIN", businessId: "test", userId: "staff" }) },
    "../_shared/llm.ts": { llmText, llmAvailable: () => true },
    "../_shared/kb.ts": { embedText: async () => null },
    "../_shared/demo-guide.ts": guide,
  });
  const response = await handler(new Request("https://test.invalid", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "Where is Simple View?", page: "/", history: [
      { role: "assistant", content: "Chat FAQ is in the Admin sidebar. Go to /payment-reminders for unpaid bookings." },
    ] }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ answer: "Open the full dashboard and choose Simple View.", sources: [] });
  expect(llmText).toHaveBeenCalledOnce();
  const prompt = (llmText.mock.calls[0] as any)[0].system as string;
  expect(prompt).toContain("override older assistant replies");
  expect(prompt).toContain("/simple/check-ins :");
  expect(prompt).toContain("Chat FAQ tab under AI");
  expect(prompt).toContain("there is no /payment-reminders page");
  expect(prompt).toContain("Embed Widget and Operations & AI Configuration");
  expect(prompt).toContain("company fields only; banking details require a main admin");
  expect(prompt).toContain("AI Usage, Chat FAQ, Partners, Data Requests, Failed Notifications");
  expect(prompt).toContain("cannot read live bookings");
  expect(prompt).toContain("not customer-available");
  expect(prompt).toContain("creating or resetting shared Guide login");
  const directory = prompt.split("Page directory (route : purpose):")[1].split("Current product notes:")[0];
  for (const match of directory.matchAll(/^(\/\S*) :/gm)) {
    expect(existsSync(join("app", match[1].split(/[?#]/)[0], "page.tsx")), match[1]).toBe(true);
  }
  expect(directory).not.toContain("/settings/ota :");
  expect(directory).not.toContain("/settings/agent-connections :");
});

it("keeps the read-only demo guide available after hidden search hits are filtered", async () => {
  const llmText = vi.fn(async () => "Explore the demo's booking and departure views.");
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { settings_permissions: {} } }) };
  const handler = sourceHandler("supabase/functions/admin-help-chat/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => ({ from: () => q, rpc: async () => ({ data: [
        { title: "Hidden guide", route: "/guide", content: "HIDDEN_DEMO_EXCERPT", similarity: 1 },
      ] }) }),
      getAdminAppOrigins: () => ["https://test.invalid"], isAllowedOrigin: () => true,
    },
    "../_shared/auth.ts": { requireAuth: async () => ({ readOnly: true, role: "MAIN_ADMIN", businessId: "test", userId: "demo" }) },
    "../_shared/llm.ts": { llmText, llmAvailable: () => true },
    "../_shared/kb.ts": { embedText: async () => [0] },
    "../_shared/demo-guide.ts": guide,
  });
  const response = await handler(new Request("https://test.invalid", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "Show me every part of the operator system", page: "/" }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, sources: [] });
  expect(llmText).toHaveBeenCalledOnce();
  const prompt = (llmText.mock.calls[0] as any)[0].system as string;
  expect(prompt).not.toContain("HIDDEN_DEMO_EXCERPT");
  expect(prompt).toContain("Forms are preview-only in this demo.");
  const directory = prompt.split("Page directory (route : purpose):")[1].split("Current product notes:")[0];
  for (const path of ["/guide", "/simple/photos", "/customers", "/reviews", "/notifications", "/settings/ota", "/super-admin"]) {
    expect(directory).not.toContain(`${path} :`);
  }
  expect(directory).toContain("/photos :");
  expect(prompt).not.toContain("Released workflow notes:");
});

it("keeps today's released workflows and limits available to an owner when retrieval is unavailable", async () => {
  const llmText = vi.fn(async () => "Open Settings, then Admin Users and Guide login.");
  const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { settings_permissions: {} } }) };
  const handler = sourceHandler("supabase/functions/admin-help-chat/index.ts", {
    "../_shared/tenant.ts": {
      createServiceClient: () => ({ from: () => query, rpc: vi.fn() }),
      getAdminAppOrigins: () => ["https://test.invalid"], isAllowedOrigin: () => true,
    },
    "../_shared/auth.ts": { requireAuth: async () => ({ readOnly: false, role: "MAIN_ADMIN", businessId: "test", userId: "owner" }) },
    "../_shared/llm.ts": { llmText, llmAvailable: () => true },
    "../_shared/kb.ts": { embedText: async () => null },
    "../_shared/demo-guide.ts": guide,
  });
  const response = await handler(new Request("https://test.invalid", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "How do I set up guides and the new follow-ups?", page: "/settings", history: [
      { role: "assistant", content: "Create an ordinary admin account for guides. Welcome-back emails start when you save and use signup date." },
    ] }),
  }));
  expect(response.status).toBe(200);
  const prompt = (llmText.mock.calls[0] as any)[0].system as string;
  for (const fact of ["Settings → Admin Users → Guide login", "one-use password setup link, valid for 48 hours", "one shared guide@operator-name login", "directly into /simpleguide", "client names, group sizes, phone/email contact links and full or partial check-ins", "no office dashboard, walk-in, payment recording", "Never ask for a password or private setup token", "Payment recovery", "its payment status remains available in Bookings", "operator writes and sends the message", "previous paid/completed booking date", "largest matching percentage wins", "Days since last paid booking, never signup date", "channel is email only", "Saving alone does not start emails.", "partial group arrival counts", "invalid configured price blocks booking creation"]) {
    expect(prompt).toContain(fact);
  }
  expect(prompt).toContain("override older assistant replies");
  expect(await response.json()).toMatchObject({ sources: [] });
});
