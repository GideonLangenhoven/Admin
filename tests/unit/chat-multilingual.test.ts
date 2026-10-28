import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourceExports, sourceFunction } from "../helpers/source-handler";
import { webChatFixture } from "../helpers/web-chat-fixture";

// Owner decision 2026-10-28: guests chat in any language on both bots, and the
// team reads every guest message in English too.
function translator(reply: string | null) {
  const calls: any[] = [];
  const mod = sourceExports("supabase/functions/_shared/translate.ts", { "./llm.ts": { llmText: async (o: any) => { calls.push(o); return reply; } } }) as any;
  return { ...mod, calls };
}

describe("translate module", () => {
  it("plain English and short replies cost no model call", async () => {
    const t = translator('{"lang":"af","english":"x"}');
    expect(await t.readGuestMessage("Hi, can I book for tomorrow please?", "a")).toEqual({ lang: "en", english: "Hi, can I book for tomorrow please?" });
    expect(await t.readGuestMessage("2", "a")).toBeNull();
    expect(t.calls).toEqual([]);
  });

  it("detects the language and translates to English", async () => {
    const t = translator('{"lang":"DE","english":"Do you have space tomorrow morning?"}');
    expect(await t.readGuestMessage("Habt ihr morgen früh noch Platz?", "a")).toEqual({ lang: "de", english: "Do you have space tomorrow morning?" });
    expect(t.calls[0]).toMatchObject({ businessId: "a", label: "chat-translate-in" });
    expect(await translator("not json").readGuestMessage("Habt ihr morgen früh noch Platz?", "a")).toBeNull();
  });

  it("a translation that drops a link, code or amount goes out in English", async () => {
    const t = translator('["Betaal R800 hier: https://pay.x/1", "Jou kode is weg", "Ja"]');
    const out = await t.translateOutgoing(["Pay R800 here: https://pay.x/1", "Your code is GIFT-7Q2X", "Yes"], "af", "a");
    expect(out).toEqual(["Betaal R800 hier: https://pay.x/1", "Your code is GIFT-7Q2X", "Ja"]);
    expect(await t.translateOutgoing(["Yes"], "en", "a")).toEqual(["Yes"]);
    expect(t.calls).toHaveLength(1);
  });
});

describe("WhatsApp", () => {
  it("sends in the guest's language and keeps the English for the Inbox", async () => {
    const meta: any[] = []; const inserts: any[] = [];
    const guestLanguage = new Map([["tenant-a:27825550100", "af"]]);
    const send = sourceFunction("supabase/functions/wa-webhook/index.ts", "sendWA", {
      guestLanguage, structuredClone, recordWaMessage: async () => undefined,
      translateWaBody: sourceFunction("supabase/functions/wa-webhook/index.ts", "translateWaBody", {
        clip: (s: string, max: number) => s.slice(0, max),
        translateOutgoing: async (texts: string[]) => texts.map(t => "[af] " + t),
      }),
      fetch: async (_u: string, init: any) => { meta.push(JSON.parse(init.body)); return Response.json({ messages: [{ id: "w" }] }); },
      supabase: { from: () => ({ insert: async (row: any) => { inserts.push(row); return { error: null }; } }) },
    });
    const tenant = { business: { id: "tenant-a" }, credentials: { waPhoneId: "p", waToken: "t" } };
    const body = { type: "interactive", interactive: { type: "button", body: { text: "Pick one" }, action: { buttons: [{ type: "reply", reply: { id: "YES", title: "Yes please, book it" } }] } } };
    await send(tenant, "27825550100", body);
    expect(meta[0].interactive.body.text).toBe("[af] Pick one");
    expect(meta[0].interactive.action.buttons[0].reply).toEqual({ id: "YES", title: "[af] Yes please, boo" });
    expect(body.interactive.body.text).toBe("Pick one");
    expect(inserts[0]).toMatchObject({ body: "[af] Pick one", body_en: "Pick one" });
  });
});

describe("web chat", () => {
  it("replies and labels buttons in the guest's language, and logs both versions", async () => {
    const chat = webChatFixture();
    chat.settings.guestLanguage = "af";
    const token = await chat.session();
    const result = await chat.post(token, "Wat moet ek saambring?");
    expect(result.reply).toMatch(/^\[af\] /);
    for (const b of result.buttons || []) expect(b.label).toMatch(/^\[af\] /);
    expect(chat.rows.conversations.find(c => c.business_id === "a")?.language).toBe("af");
    const inbound = chat.rows.chat_messages.find(m => m.direction === "IN");
    expect(inbound).toMatchObject({ body: "Wat moet ek saambring?", body_en: "EN: Wat moet ek saambring?" });
    const outbound = chat.rows.chat_messages.find(m => m.direction === "OUT");
    expect(outbound.body).toBe(result.reply);
    expect("[af] " + outbound.body_en).toBe(result.reply);
  });

  it("English guests are untouched", async () => {
    const chat = webChatFixture();
    const result = await chat.post(await chat.session(), "What should I bring?");
    expect(result.reply).not.toMatch(/^\[/);
    expect(chat.rows.chat_messages.every(m => !m.body_en)).toBe(true);
  });
});

describe("team side", () => {
  it("admin replies go out in the guest's language with the English kept", () => {
    const fn = readFileSync("supabase/functions/admin-reply/index.ts", "utf8");
    expect(fn).toMatch(/if \(convo\?\.language\) message = \(await translateOutgoing\(\[message\], convo\.language, actualBusinessId\)\)\[0\]/);
    expect(fn.match(/body_en: bodyEn/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("the Inbox shows the English under a guest's own words", () => {
    expect(readFileSync("app/inbox/page.tsx", "utf8")).toMatch(/m\.body_en && <p[^>]*>.*English:/s);
  });

  it("the migration adds the two columns", () => {
    const sql = readFileSync("supabase/migrations/20261028200000_chat_guest_language.sql", "utf8");
    expect(sql).toContain("conversations ADD COLUMN IF NOT EXISTS language text");
    expect(sql).toContain("chat_messages ADD COLUMN IF NOT EXISTS body_en text");
  });
});
