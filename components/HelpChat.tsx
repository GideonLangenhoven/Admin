"use client";

// Floating in-dashboard help assistant. Answers "where do I find X / how does
// Y work" questions via the admin-help-chat edge function, which retrieves
// from the platform help KB (docs/admin-help) — role-filtered server-side.
// Mounted once in AppShell so it's available on every admin page.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChatCircleDots, PaperPlaneRight, X } from "@phosphor-icons/react";
import { supabase } from "../app/lib/supabase";
import { parseActions } from "./helpChatActions";
import { useBusinessContext } from "./BusinessContext";
import { WELCOME_TOUR_EVENT } from "./WelcomeChecklist";

type Msg = {
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; route: string }[];
};

const SUGGESTED: { q: string; privilegedOnly?: boolean }[] = [
  { q: "How do I cancel a day for bad weather?" },
  { q: "Where do I see refund requests?" },
  { q: "Help me add slots for next month" },
  { q: "How do I add another admin user?", privilegedOnly: true },
  { q: "Why can't I reply to a WhatsApp message?" },
];

const GREETING =
  "Hi! I can explain how the dashboard works, open the right page for you, and even fill things in. Ask me anything, or try one of these:";

const LINK_SPLIT_RE = /(\[[^\]]+\]\(\/[a-zA-Z0-9\-/_?=&]*\))/g;
const LINK_MATCH_RE = /^\[([^\]]+)\]\((\/[a-zA-Z0-9\-/_?=&]*)\)$/;

// ---- assistant-driven actions ----------------------------------------------
// The edge function's reply may end with directives the assistant uses to
// drive the dashboard: [[open:/route]], [[fill:name=value]], [[submit]].
// parseActions (components/helpChatActions.ts) splits them off the prose;
// they are executed client-side here, so everything the assistant "does"
// goes through the app's own pages and server-side authorization, exactly
// as if the admin clicked it themselves.

/**
 * Poll for a VISIBLE element until the page (possibly mid-navigation,
 * possibly a modal still opening) has it. Visibility matters: hidden or
 * collapsed duplicates must never be filled or clicked.
 */
function waitForVisible(selector: string, timeoutMs = 10_000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const el = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((e) => e.offsetParent !== null);
      if (el) return resolve(el);
      if (Date.now() - started > timeoutMs) return resolve(null);
      setTimeout(tick, 250);
    };
    tick();
  });
}

/** Set a field the way a user would, so React-controlled inputs notice too. */
function setField(el: HTMLElement, value: string): void {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    const want = value === "true" || value === "on" || value === "1";
    if (el.checked !== want) el.click();
    return;
  }
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  (el as HTMLInputElement).focus?.();
}

// Renders assistant text, turning internal markdown links [Label](/route)
// into client-side <Link>s. Everything else is plain text — no HTML injection.
function AnswerText({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const parts = text.split(LINK_SPLIT_RE);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        const m = part.match(LINK_MATCH_RE);
        if (m) {
          return (
            <Link key={i} href={m[2]} onClick={onNavigate} className="font-semibold underline underline-offset-2" style={{ color: "var(--ck-accent)" }}>
              {m[1]}
            </Link>
          );
        }
        // Strip stray markdown bold markers so raw asterisks never show.
        return <span key={i}>{part.replace(/\*\*([^*]+)\*\*/g, "$1")}</span>;
      })}
    </span>
  );
}

export default function HelpChat() {
  const { businessId, role } = useBusinessContext();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);

  function replayTour() {
    setOpen(false);
    window.dispatchEvent(new Event(WELCOME_TOUR_EVENT));
  }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Per-admin "hide the bubble" preference (admin_users.help_chat_hidden),
  // toggled under Settings → Dashboard Preferences. The custom event makes
  // the toggle take effect without a reload.
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    supabase.rpc("get_my_admin_onboarding").then(({ data }) => {
      if (!cancelled && Array.isArray(data) && data[0]?.help_chat_hidden) setHidden(true);
    });
    function onVisibility(e: Event) {
      setHidden(!!(e as CustomEvent).detail?.hidden);
    }
    window.addEventListener("ck-help-chat-hidden", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("ck-help-chat-hidden", onVisibility);
    };
  }, [businessId]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!businessId || hidden) return null;

  const isPrivileged = role === "MAIN_ADMIN" || role === "SUPER_ADMIN";
  const suggestions = SUGGESTED.filter((s) => !s.privilegedOnly || isPrivileged);

  // Following a link out of the assistant used to close it unconditionally,
  // which reads as the bot quitting on you mid-conversation. It only needs to
  // move on mobile, where the panel is a bottom sheet over 75dvh and would
  // hide the page you just asked to see; on desktop it's a 380px corner card
  // that obscures nothing. The thread itself always survives either way —
  // HelpChat is mounted in the root layout, so client-side navigation never
  // unmounts it.
  function handleNavigate() {
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 768px)").matches) {
      setOpen(false);
    }
  }

  // Execute the reply's directives: navigate, fill visible inputs the way a
  // user would, and only press a button when the assistant was told to. All of
  // it happens in the admin's own session on the app's own pages, so every
  // role check and business_id scope applies exactly as for a manual click.
  async function runActions(openPath: string | null, fills: [string, string][], submit: boolean) {
    if (openPath && openPath.startsWith("/")) {
      router.push(openPath);
      handleNavigate();
    }
    if (fills.length === 0 && !submit) return;
    const missed: string[] = [];
    let form: HTMLFormElement | null = null;
    for (const [name, value] of fills) {
      const el = await waitForVisible(`[name="${CSS.escape(name)}"]`);
      if (el) {
        setField(el, value);
        form = el.closest("form") ?? form;
      } else missed.push(name);
    }
    const filled = fills.length - missed.length;
    let status = "";
    if (missed.length) {
      status = `I filled what I could, but couldn't find: ${missed.join(", ")}. Make sure the right page is open and try again.`;
    } else if (submit) {
      let pressed = false;
      if (form) {
        form.requestSubmit();
        pressed = true;
      } else {
        const btn = await waitForVisible("[data-help-submit]");
        if (btn) {
          btn.click();
          pressed = true;
        }
      }
      status = pressed
        ? (filled ? `Filled ${filled} field${filled === 1 ? "" : "s"} and submitted it. The page is saving now.` : "Submitted it for you. The page is saving now.")
        : "I couldn't find the button to press on this page. Please press it yourself.";
    } else if (filled) {
      status = `Filled ${filled} field${filled === 1 ? "" : "s"} for you. Check the values, then press the page's own button to save.`;
    }
    if (status) setMessages((m) => [...m, { role: "assistant", content: status }]);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    try {
      const res = await supabase.functions.invoke("admin-help-chat", {
        body: { question: q, page: pathname, history },
      });
      const answer: string = res.data?.answer || "";
      if (res.error || !answer) throw new Error(res.error?.message || "empty");
      const { text, open: openPath, fills, submit } = parseActions(answer);
      setMessages((prev) => [...prev, { role: "assistant", content: text || "On it.", sources: res.data?.sources || [] }]);
      await runActions(openPath, fills, submit);
    } catch {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "Sorry, I couldn't reach the help service just now. Please try again in a moment.",
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Launcher — above the mobile bottom nav, corner on desktop */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open AI help"
          className="fixed bottom-20 right-4 z-40 flex h-12 items-center justify-center gap-2 rounded-full px-4 transition-transform hover:scale-105 md:bottom-6 md:right-6"
          style={{ background: "var(--ck-accent)", color: "#fff", boxShadow: "var(--ck-shadow-lg)" }}
        >
          <ChatCircleDots size={24} weight="fill" />
          <span className="text-sm font-semibold">AI help</span>
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="AI help"
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-t-2xl md:inset-x-auto md:bottom-6 md:right-6 md:h-[560px] md:max-h-[calc(100dvh-48px)] md:w-[380px] md:rounded-2xl"
          style={{ background: "var(--ck-surface)", border: "1px solid var(--ck-border-subtle)", boxShadow: "var(--ck-shadow-lg)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ background: "var(--ck-accent)", color: "#fff" }}>
            <div className="flex items-center gap-2">
              <div>
                <div className="text-sm font-semibold leading-tight">AI help</div>
                <div className="text-[11px] opacity-80 leading-tight">Ask how anything works</div>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close help" className="rounded p-1 hover:bg-white/15">
              <X size={18} />
            </button>
          </div>

          {/* Thread */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <div className="text-sm" style={{ color: "var(--ck-text)" }}>{GREETING}</div>
            {messages.length === 0 && (
              <div className="flex flex-col items-start gap-2">
                <button
                  type="button"
                  onClick={replayTour}
                  className="rounded-full border px-3 py-1.5 text-left text-[13px] font-semibold transition-colors hover:border-transparent"
                  style={{ borderColor: "var(--ck-accent)", color: "var(--ck-accent)", background: "var(--ck-success-soft, rgba(18,94,64,0.06))" }}
                >
                  Show me around the dashboard
                </button>
                {suggestions.map((s) => (
                  <button
                    key={s.q}
                    type="button"
                    onClick={() => ask(s.q)}
                    className="rounded-full border px-3 py-1.5 text-left text-[13px] transition-colors hover:border-transparent"
                    style={{ borderColor: "var(--ck-border-strong)", color: "var(--ck-text-strong)", background: "var(--ck-surface-warm)" }}
                  >
                    {s.q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className="max-w-[85%] [overflow-wrap:anywhere] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                  style={m.role === "user"
                    ? { background: "var(--ck-accent)", color: "#fff", borderBottomRightRadius: 6 }
                    : { background: "var(--ck-surface-warm)", color: "var(--ck-text-strong)", border: "1px solid var(--ck-border-subtle)", borderBottomLeftRadius: 6 }}
                >
                  {m.role === "assistant" ? <AnswerText text={m.content} onNavigate={handleNavigate} /> : m.content}
                  {m.role === "assistant" && (m.sources?.length || 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.sources!.map((s) => (
                        <Link
                          key={s.route}
                          href={s.route}
                          onClick={handleNavigate}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                          style={{ background: "var(--ck-success-soft, rgba(18,94,64,0.1))", color: "var(--ck-accent)" }}
                        >
                          {s.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3.5 py-2.5" style={{ background: "var(--ck-surface-warm)", border: "1px solid var(--ck-border-subtle)" }}>
                  <span className="inline-flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: "var(--ck-text-muted)", animationDelay: d * 120 + "ms" }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => { e.preventDefault(); ask(input); }}
            className="flex items-center gap-2 border-t px-3 py-3"
            style={{ borderColor: "var(--ck-border-subtle)" }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. How do I refund a booking?"
              maxLength={1000}
              className="ui-control flex-1 text-[16px] md:text-sm"
              aria-label="Your question"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send question"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] disabled:opacity-40"
              style={{ background: "var(--ck-accent)", color: "#fff" }}
            >
              <PaperPlaneRight size={16} weight="fill" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
