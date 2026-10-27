"use client";

// Floating in-dashboard help assistant. Answers "where do I find X / how does
// Y work" questions via the admin-help-chat edge function, which retrieves
// from the platform help KB (docs/admin-help) — role-filtered server-side.
// Mounted once in AppShell so it's available on every admin page.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChatCircleDots, PaperPlaneRight, X } from "@phosphor-icons/react";
import { supabase } from "../app/lib/supabase";
import { parseActions } from "./helpChatActions";
import { useBusinessContext } from "./BusinessContext";
import { WELCOME_TOUR_EVENT } from "./WelcomeChecklist";
import { isDemoPathVisible } from "../app/lib/demo-guide";

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

const DEMO_SUGGESTED = [
  "Show me every part of the operator system",
  "Walk me through a booking from sale to check-in",
  "Explain payments, vouchers, cancellations and refunds",
  "Show me WhatsApp, web chat and automated messages",
  "Explain marketing campaigns, automations and trip photos",
  "Show me settings, staff access and integrations",
].map((q) => ({ q }));

const GREETING =
  "I can explain tasks, open pages and fill forms. What do you need?";

const LINK_SPLIT_RE = /(\[[^\]]+\]\(\/[a-zA-Z0-9\-/_?=&#]*\))/g;
const LINK_MATCH_RE = /^\[([^\]]+)\]\((\/[a-zA-Z0-9\-/_?=&#]*)\)$/;

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
function AnswerText({ text, readOnly }: { text: string; readOnly?: boolean }) {
  const parts = text.split(LINK_SPLIT_RE);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        const m = part.match(LINK_MATCH_RE);
        if (m) {
          if (readOnly && !isDemoPathVisible(m[2])) return <span key={i}>{m[1]} (not included in this demo)</span>;
          return (
            <Link key={i} href={m[2]} onClick={(event) => {
              if (readOnly && m[2].startsWith(window.location.pathname + "#")) {
                event.preventDefault();
                window.location.hash = m[2].split("#")[1];
              }
            }} className="font-semibold underline underline-offset-2" style={{ color: "var(--ck-accent)" }}>
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

export default function HelpChat({ inline = false }: { inline?: boolean }) {
  const { businessId, role, readOnly } = useBusinessContext();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [panelBounds, setPanelBounds] = useState({ top: 0, maxHeight: 0 });
  const [hidden, setHidden] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);

  function replayTour() {
    setOpen(false);
    window.dispatchEvent(new Event(WELCOME_TOUR_EVENT));
  }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!open || !inline) return;
    const viewport = window.visualViewport;
    function positionPanel() {
      const top = (launcherRef.current?.getBoundingClientRect().bottom ?? 0) + 8;
      setPanelBounds({ top, maxHeight: Math.max(0, (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - top - 16) });
    }
    positionPanel();
    window.addEventListener("resize", positionPanel);
    viewport?.addEventListener("resize", positionPanel);
    viewport?.addEventListener("scroll", positionPanel);
    return () => {
      window.removeEventListener("resize", positionPanel);
      viewport?.removeEventListener("resize", positionPanel);
      viewport?.removeEventListener("scroll", positionPanel);
    };
  }, [open, inline]);

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

  if (!businessId || (hidden && !readOnly)) return null;

  const isPrivileged = role === "MAIN_ADMIN" || role === "SUPER_ADMIN";
  const suggestions = readOnly ? DEMO_SUGGESTED : SUGGESTED.filter((s) => !s.privilegedOnly || isPrivileged);

  // Opening a page, by a directive or one of the answer's links, keeps the
  // panel open at every width so the answer stays beside the page; only the
  // X or Escape closes it (M12). HelpChat lives in the root layout, so
  // client-side navigation never unmounts the thread.
  // Execute the reply's directives: navigate, fill visible inputs the way a
  // user would, and only press a button when the assistant was told to. All of
  // it happens in the admin's own session on the app's own pages, so every
  // role check and business_id scope applies exactly as for a manual click.
  async function runActions(openPath: string | null, fills: [string, string][], submit: boolean) {
    if (openPath && openPath.startsWith("/") && (!readOnly || isDemoPathVisible(openPath))) {
      if (readOnly && openPath.split("#")[0] === pathname && openPath.includes("#")) window.location.hash = openPath.split("#")[1];
      else router.push(openPath);
    }
    if (fills.length === 0 && !submit) return;
    if (readOnly) {
      setMessages((m) => [...m, { role: "assistant", content: "In this demo I can open pages and explain tasks. Forms and data stay unchanged." }]);
      return;
    }
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
        : "Button not found. Please use the page's button.";
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
      {/* The dashboard mounts its launcher in the toolbar, clear of actions. */}
      {(inline || !open) && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={readOnly ? "Open AI bot" : "Open AI help"}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={inline
            ? "flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-3 transition-colors"
            : "fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105 lg:bottom-6 lg:right-6 lg:h-12 lg:w-auto lg:gap-2 lg:px-4"}
          style={{ background: "var(--ck-accent)", color: "#fff", boxShadow: "var(--ck-shadow-lg)" }}
        >
          <ChatCircleDots size={22} weight="fill" />
          <span className="hidden lg:inline text-sm font-semibold">{readOnly ? "AI bot" : "AI help"}</span>
        </button>
      )}

      {/* Render outside the blurred toolbar, which contains fixed descendants. */}
      {open && createPortal(
        <div
          role="dialog"
          aria-label={readOnly ? "AI bot" : "AI help"}
          className={inline
            ? "fixed right-4 z-50 flex h-[560px] w-[380px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl"
            : "fixed inset-x-0 bottom-0 z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-t-2xl lg:inset-x-auto lg:bottom-6 lg:right-6 lg:h-[560px] lg:max-h-[calc(100dvh-48px)] lg:w-[380px] lg:rounded-2xl"}
          style={{ background: "var(--ck-surface)", border: "1px solid var(--ck-border-subtle)", boxShadow: "var(--ck-shadow-lg)", ...(inline ? panelBounds : {}) }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between px-4 py-3" style={{ background: "var(--ck-accent)", color: "#fff" }}>
            <div className="flex items-center gap-2">
              <div>
                <div className="text-sm font-semibold leading-tight">{readOnly ? "AI bot" : "AI help"}</div>
                <div className="text-[11px] opacity-80 leading-tight">Ask how anything works</div>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close help" className="rounded p-1 hover:bg-white/15">
              <X size={18} />
            </button>
          </div>

          {/* Thread */}
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <div className="text-sm" style={{ color: "var(--ck-text)" }}>{readOnly
              ? "Ask how a feature works. I can open pages; this demo saves and sends nothing."
              : GREETING}</div>
            {messages.length === 0 && (
              <div className="flex flex-col items-start gap-2">
                <button
                  type="button"
                  onClick={() => readOnly ? ask("Show me every part of the operator system") : replayTour()}
                  className="rounded-full border px-3 py-1.5 text-left text-[13px] font-semibold transition-colors hover:border-transparent"
                  style={{ borderColor: "var(--ck-accent)", color: "var(--ck-accent)", background: "var(--ck-success-soft, rgba(18,94,64,0.06))" }}
                >
                  {readOnly ? "Product tour" : "Dashboard tour"}
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
                  {m.role === "assistant" ? <AnswerText text={m.content} readOnly={readOnly} /> : m.content}
                  {m.role === "assistant" && (m.sources?.length || 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.sources!.filter(s => !readOnly || isDemoPathVisible(s.route)).map((s) => (
                        <Link
                          key={s.route}
                          href={s.route}
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
            className="flex shrink-0 items-center gap-2 border-t px-3 py-3"
            style={{ borderColor: "var(--ck-border-subtle)" }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. How do I refund a booking?"
              maxLength={1000}
              className="ui-control min-w-0 flex-1 text-[16px] md:text-sm"
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
        </div>, document.body
      )}
    </>
  );
}
