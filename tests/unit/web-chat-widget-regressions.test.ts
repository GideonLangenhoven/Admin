import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChatContact } from "../../supabase/functions/_shared/chat-contact";
import { sourceFunction } from "../helpers/source-handler";
import { webChatFixture } from "../helpers/web-chat-fixture";

const widget = "booking/app/components/ChatWidget.tsx";
const plainChatText = sourceFunction(widget, "plainChatText", {});

function sender(state: any, invokeChat: (body: any) => Promise<any>, input = "") {
  const rendered = { state, messages: [{ role: "bot", text: "Choose a departure." }] as any[], error: "", failed: null as any };
  const sendingRef = { current: false }, requestVersionRef = { current: 0 };
  const send = sourceFunction(widget, "send", {
    input, st: state, msgs: rendered.messages, sendingRef, requestVersionRef,
    chatSession: "fixture-session", sessionReady: true, rated: false, parseChatContact, plainChatText, invokeChat,
    inRef: { current: { focus() {} } }, requestAnimationFrame: (callback: () => void) => callback(),
    setMsgs: (value: any) => { rendered.messages = typeof value === "function" ? value(rendered.messages) : value; },
    setSt: (value: any) => { rendered.state = value; },
    setContactError: (value: string) => { rendered.error = value; },
    setFailedMessage: (value: any) => { rendered.failed = value; },
    setInput() {}, setTyping() {}, setRestartError() {}, setShowRating() {},
  });
  return { send, rendered, sendingRef, requestVersionRef };
}

describe("widget contact validation and asynchronous selection boundaries", () => {
  it.each(["Email: guest@@example.com", "Phone: invalid", "Email:"])("validates %s in the UI before sending, without advancing", async input => {
    let requests = 0;
    const state = { step: "ASK_DETAILS", name: "Zoë O'Neill", email: "zoe@example.com", phone: "+353 87 123 4567" };
    const s = sender(state, async () => { requests++; return {}; }, input);
    await s.send();
    expect(requests).toBe(0);
    expect(s.rendered.state).toEqual(state);
    expect(s.rendered.error).toMatch(input.startsWith("Email") ? /valid email/ : /valid phone/);
    expect(s.rendered.messages).toHaveLength(1);
  });

  it("routes a tour change before validating contact-shaped text in the UI", async () => {
    const f = webChatFixture();
    f.rows.tours.push({ ...f.tour, id: "other", name: "Sunset Paddle" });
    f.rows.slots.push({ ...f.slot, id: "other-slot", tour_id: "other" });
    const token = await f.session();
    const s = sender({ ...f.bookingState, step: "ASK_DETAILS" }, async body => ({ data: await f.post(token, body.message, body.state) }), "Switch to Sunset Paddle, Email: wrong");
    await s.send();
    expect(s.rendered.state).toMatchObject({ step: "PICK_DATE", tid: "other" });
    expect(s.rendered.error).toBe("");
  });

  it("locks a delayed availability request against rapid repeated Send calls", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    const s = sender({ step: "PICK_DATE" }, async () => { requests++; await gate; return { data: { reply: "Current date options", state: { step: "PICK_TIME", selectedDate: "2026-10-14" } } }; }, "2026-10-14");
    const first = s.send();
    await s.send();
    expect(requests).toBe(1);
    expect(s.sendingRef.current).toBe(true);
    release();
    await first;
    expect(s.rendered.messages).toHaveLength(3);
    expect(s.rendered.messages.filter(message => message.role === "user")).toHaveLength(1);
    expect(s.rendered.state.selectedDate).toBe("2026-10-14");
    expect(s.sendingRef.current).toBe(false);
  });

  it("keeps the newer selection when old availability finishes after a refresh/remount", async () => {
    const f = webChatFixture();
    const firstDate = f.bookingState.selectedDate;
    const next = new Date(firstDate + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    f.slot.start_time = firstDate + "T08:30:00+02:00";
    f.rows.slots.push({ ...f.slot, id: "new-date", start_time: nextDate + "T11:00:00+02:00" });
    const token = await f.session();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const rpc = f.db.rpc;
    let availabilityCalls = 0;
    f.db.rpc = async (name, args) => {
      if (name === "list_available_slots" && ++availabilityCalls === 1) { entered(); await gate; }
      return rpc(name, args);
    };
    const state = { ...f.bookingState, step: "PICK_TIME", selectedDate: firstDate, pendingDate: firstDate, pendingTime: "06:00" };
    const invoke = async (body: any) => ({ data: await f.post(token, body.message, body.state) });
    const oldWidget = sender(state, invoke, firstDate);
    const oldRequest = oldWidget.send();
    await started;
    // This is the actual unmount cleanup used by ChatWidget.
    oldWidget.requestVersionRef.current++;
    const newWidget = sender(state, invoke, nextDate);
    await newWidget.send();
    expect(newWidget.rendered.state).toMatchObject({ step: "PICK_TIME", selectedDate: nextDate });
    expect(newWidget.rendered.messages.at(-1).buttons).toEqual([{ label: "11:00 (10 spots)", value: "new-date" }]);
    release();
    await oldRequest;
    expect(oldWidget.rendered.messages.filter(message => message.role === "bot")).toHaveLength(1);
    expect(newWidget.rendered.state.selectedDate).toBe(nextDate);
    expect(newWidget.rendered.messages.at(-1).text).not.toContain("06:00");
    expect(f.rows.bookings).toEqual([]);
  });

  it("removes emphasis delimiters and retains untrusted HTML as ordinary text", () => {
    expect(plainChatText("**Full name**, *Email*: and\n* Phone\n*(One at a time)*")).toBe("Full name, Email: and\n• Phone\n(One at a time)");
    const untrusted = '<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>';
    expect(plainChatText(untrusted)).toBe(untrusted);
    expect(plainChatText("guest_name@example.com")).toBe("guest_name@example.com");
  });
});

describe("widget polling and input", () => {
  const src = readFileSync(widget, "utf8");
  it("polls for operator replies in bot mode too, slower than with a human, never from a hidden tab", () => {
    expect(src).toContain("if (!open || !chatSession || !sessionReady) return;\n    if (!lastPollRef.current)");
    expect(src).toContain("if (polling || document.hidden) return;");
    expect(src).toContain("}, isHuman ? 4000 : 20_000);");
  });
  it("keeps the message box at 16px so iOS doesn't zoom on focus", () => {
    const input = src.slice(src.indexOf('aria-label="Chat message"'), src.indexOf("/>", src.indexOf('aria-label="Chat message"')));
    expect(input).toContain("text-base");
    expect(input).not.toContain("text-sm");
  });
});

describe("widget Turnstile", () => {
  const src = readFileSync(widget, "utf8");
  it("sends a Turnstile token when starting a chat, once a site key is set", () => {
    expect(src).toContain("const turnstile_token = TURNSTILE_SITE_KEY && turnstileRef.current ? await turnstileToken(turnstileRef.current) : undefined;");
    expect(src).toContain('body: { action: "session", business_id: businessId, chat_session: saved, turnstile_token },');
  });
  it("the booking site's CSP lets Cloudflare's script and frame load", () => {
    const csp = readFileSync("booking/next.config.ts", "utf8");
    expect(csp).toMatch(/"script-src [^"]*https:\/\/challenges\.cloudflare\.com"/);
    expect(csp).toMatch(/"frame-src [^"]*https:\/\/challenges\.cloudflare\.com"/);
  });
});
