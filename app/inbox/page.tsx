"use client";
import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import IntentBadge from "../../components/inbox/IntentBadge";
import { Virtuoso } from "react-virtuoso";
import BotStatusBanner from "./components/BotStatusBanner";
import { Warning, X as XIcon } from "@phosphor-icons/react";

function MessageList({
  messages,
  endRef,
  fmtTime,
  fmtDate,
}: {
  messages: any[];
  endRef: React.RefObject<HTMLDivElement | null>;
  fmtTime: (iso: string) => string;
  fmtDate: (iso: string) => string;
}) {
  // The full thread — bot, customer and admin turns — grouped by day so an
  // operator can scan when the customer wrote and what was discussed.
  return (
    <>
      {messages.map((m: any, i: number, arr: any[]) => {
        const isOut = m.direction === "OUT";
        const isBot = isOut && m.sender !== "Admin";
        const showDate = i === 0 || fmtDate(m.created_at) !== fmtDate(arr[i - 1].created_at);
        return (
          <div key={m.id}>
            {showDate && (
              <div className="text-center my-2">
                <span className="font-mono text-[11px] px-3 py-1 rounded-full" style={{ background: "var(--ck-surface-sunken)", color: "var(--ck-text-muted)" }}>{fmtDate(m.created_at)}</span>
              </div>
            )}
            <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] [overflow-wrap:anywhere] px-3 py-2 rounded-2xl text-sm ${isOut
                ? (isBot
                  ? "bg-[var(--ck-surface-sunken)] border border-[var(--ck-border-subtle)] text-[var(--ck-text-muted)] rounded-br-md"
                  : "bg-[var(--ck-accent-soft)] text-[var(--ck-text-strong)] rounded-br-md")
                : "bg-[var(--ck-surface-sunken)] border border-[var(--ck-border-subtle)] text-[var(--ck-text)] rounded-bl-md"
                }`}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="text-xs mt-1" style={{ color: "var(--ck-text-muted)" }}>
                  {fmtTime(m.created_at)} · {m.sender || (isOut ? "Admin" : "Customer")}
                </p>
              </div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </>
  );
}

const needsAttention = (c: any) => c.status === "HUMAN" || c.status === "AGENT_PENDING";

function ConvoRow({ c, isSelected, onClick }: { c: any; isSelected: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick}
      className={`p-3 border-b border-[var(--ck-border-subtle)] cursor-pointer transition-colors ${isSelected ? "bg-[var(--ck-accent-soft)] border-l-4 border-l-[var(--ck-accent)]" : "hover:bg-[var(--ck-surface-sunken)]"}`}>
      <div className="flex items-center gap-2">
        {needsAttention(c) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ck-accent)]" aria-hidden="true" />}
        <p className="font-semibold text-sm truncate" style={{ color: "var(--ck-text-strong)" }}>{c.customer_name || "Unknown"}</p>
        <IntentBadge intent={c.current_intent} size="xs" />
        <span className={`ui-status ml-auto shrink-0 ${needsAttention(c) ? "ui-pill-warning" : "ui-pill-neutral"}`}>
          {needsAttention(c) ? "Needs reply" : "Bot"}
        </span>
      </div>
      <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{c.phone}</p>
      <p className="font-mono text-[11px] mt-1" style={{ color: "var(--ck-text-muted)" }}>{new Date(c.updated_at).toLocaleString("en-ZA", { timeZone: getAdminTimezone() })}</p>
    </div>
  );
}

function InboxContent() {
  const { businessId } = useBusinessContext();
  const searchParams = useSearchParams();

  // One unified list — every conversation (bot- or human-handled, WhatsApp or
  // web chat) lives here. No forked views: chats needing a human float to the
  // top, the rest follow by recency.
  const [convos, setConvos] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const sendingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);
  const autoSelectedRef = useRef(false);

  // WhatsApp send warning (cleared when conversation changes)
  const [waWarning, setWaWarning] = useState<string | null>(null);

  // Bookings linked to this customer — matched by phone (bot bookings store the
  // WA phone verbatim) with email as the fallback for web chats.
  const [customerBookings, setCustomerBookings] = useState<any[]>([]);

  useEffect(() => {
    setCustomerBookings([]);
    if (!selected) return;
    const filters = [`phone.eq.${selected.phone}`];
    if (selected.email) filters.push(`email.eq.${selected.email}`);
    supabase.from("bookings")
      .select("id, status, slots(start_time), tours(name)")
      .eq("business_id", businessId)
      .or(filters.join(","))
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setCustomerBookings(data || []));
  }, [selected, businessId]);

  const loadConvos = useCallback(async () => {
    const { data } = await supabase.from("conversations")
      .select("id, phone, customer_name, email, status, current_state, updated_at, current_intent")
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false })
      .limit(300);
    const all = data || [];
    // Needs-attention first, each group already newest-first from the query
    setConvos([...all.filter(needsAttention), ...all.filter((c: any) => !needsAttention(c))]);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { loadConvos(); }, [loadConvos]);

  // Auto-select conversation from ?phone= query param
  useEffect(() => {
    if (autoSelectedRef.current || loading || convos.length === 0) return;
    const phone = searchParams.get("phone");
    if (!phone) return;
    const match = convos.find((c: any) => c.phone === phone);
    if (match) {
      setSelected(match);
      autoSelectedRef.current = true;
    }
  }, [convos, loading, searchParams]);

  // Clear warning when the selected conversation changes
  useEffect(() => {
    setWaWarning(null);
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) return;

    loadMessages(selected.phone);

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel("inbox-chat-" + Date.now())
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        // Tenant isolation: RLS already limits delivery to businesses this
        // admin can read, but a SUPER_ADMIN can read every tenant — without
        // this filter a customer chatting with two operators would have the
        // other operator's thread interleaved into this one.
        filter: "business_id=eq." + businessId,
      }, (payload: any) => {
        if (payload.new.phone === selected.phone && payload.new.business_id === businessId) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        }
      })
      .subscribe((status: string) => {
        console.log("Realtime status:", status);
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selected, businessId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Polling fallback
  useEffect(() => {
    if (!selected) return;
    const interval = setInterval(() => {
      loadMessages(selected.phone);
    }, 3000);
    return () => clearInterval(interval);
  }, [selected]);

  // Show typing indicator bubble while admin is composing
  useEffect(() => {
    if (!reply.trim()) { setIsTyping(false); return; }
    setIsTyping(true);
    const t = setTimeout(() => setIsTyping(false), 2000);
    return () => clearTimeout(t);
  }, [reply]);

  async function loadMessages(phone: string) {
    const { data } = await supabase.from("chat_messages")
      .select("*")
      .eq("business_id", businessId)
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1000);
    setMessages((data || []).reverse());
  }

  async function sendReply() {
    const target = selected;
    const msg = reply.trim();
    if (!msg || !target || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);

    try {
      const res = await supabase.functions.invoke("admin-reply", {
        body: { phone: target.phone, message: msg, business_id: businessId },
      });
      if (res.error) {
        notify({ title: "Reply failed", message: res.error.message, tone: "error" });
        if (/credential|token|whatsapp|wa_token|not configured/i.test(res.error.message)) {
          setWaWarning("WhatsApp is not configured for this business. Go to Settings to add your WhatsApp token and Phone ID.");
        }
      } else if (res.data && res.data.ok === false) {
        // 24-hour window — friendly guidance, no generic error toast
        if (res.data.error === "outside_24h_window") {
          setWaWarning(res.data.message || "WhatsApp requires the customer to message you first. Ask them to send you a WhatsApp message, then you can reply here.");
        } else {
          // message carries the actionable remedy (expired token, test-number
          // allow-list); error is the bare category. Prefer the remedy.
          let msgErr = res.data.message || res.data.error || "Unknown Error";
          if (res.data.details?.error?.error_data?.details) {
            msgErr += "\nDetails: " + res.data.details.error.error_data.details;
          } else if (!res.data.message && res.data.details?.error?.message) {
            msgErr += "\nDetails: " + res.data.details.error.message;
          }
          notify({ title: "Reply failed", message: msgErr, tone: "error" });
          if (/credential|token|whatsapp|wa_token|not configured/i.test(msgErr)) {
            setWaWarning("WhatsApp is not configured for this business. Go to Settings to add your WhatsApp token and Phone ID.");
          }
        }
      } else {
        // Refresh updated_at on every admin reply to keep the 2-hour bot-silence window active
        await supabase.from("conversations").update({ status: "HUMAN", updated_at: new Date().toISOString() }).eq("id", target.id);
        window.dispatchEvent(new Event("inbox-updated"));
        if (target.status !== "HUMAN") {
          setSelected({ ...target, status: "HUMAN" });
          loadConvos();
        }
        setReply("");
        // Same three outcomes as the bookings-page WhatsApp action: delivered,
        // queued behind a reopener, or diverted to email. This used to report
        // all three as a plain "Reply sent" and drop the explanation entirely.
        const channel = res.data?.channel;
        notify({
          title: channel === "email" ? "Sent by email instead" : channel === "reopener" ? "Queued for WhatsApp" : "Reply sent",
          message: res.data?.message || "The conversation remains in human handoff mode.",
          tone: channel === "email" || channel === "reopener" ? "warning" : "success",
        });
      }
    } catch (err: any) {
      notify({ title: "Reply failed", message: err.message, tone: "error" });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function returnToBot(id: string, phone: string) {
    if (!phone) return;
    try {
      const res = await supabase.functions.invoke("admin-reply", {
        body: { action: "return_to_bot", phone: phone, message: "RETURN", business_id: businessId },
      });
      if (res.error) {
        notify({ title: "Return to bot failed", message: res.error.message, tone: "error" });
      } else if (res.data && res.data.ok === false) {
        notify({ title: "Return to bot failed", message: res.data.error, tone: "error" });
      } else {
        setSelected(null);
        setMessages([]);
        loadConvos();
        // conversations isn't in the realtime publication, so the sidebar
        // badge only hears about status flips via this event.
        window.dispatchEvent(new Event("inbox-updated"));
        notify({ title: "Returned to bot", message: "The conversation was handed back to the bot.", tone: "success" });
      }
    } catch (err: any) {
      notify({ title: "Return to bot failed", message: err.message, tone: "error" });
    }
  }

  // Web chats only: end the conversation and ask the visitor to rate it. The
  // widget shows a star picker on its next poll (current_state AWAIT_RATING).
  async function endChat(phone: string) {
    if (!phone) return;
    try {
      const res = await supabase.functions.invoke("admin-reply", {
        body: { action: "end_chat", phone, message: "Thanks for chatting with us! 🙏 Before you go, please rate how we did.", business_id: businessId },
      });
      if (res.error || (res.data && res.data.ok === false)) {
        notify({ title: "End chat failed", message: res.error?.message || res.data?.error, tone: "error" });
      } else {
        setSelected(null);
        setMessages([]);
        loadConvos();
        window.dispatchEvent(new Event("inbox-updated"));
        notify({ title: "Chat ended", message: "The visitor was asked to rate the chat.", tone: "success" });
      }
    } catch (err: any) {
      notify({ title: "End chat failed", message: err.message, tone: "error" });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendingRef.current) {
        sendReply();
      }
    }
  }

  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: getAdminTimezone() });
  }

  function fmtSlot(iso: string) {
    return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
  }

  const attentionCount = convos.filter(needsAttention).length;
  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const visibleConvos = q
    ? convos.filter((c: any) =>
        String(c.customer_name || "").toLowerCase().includes(q)
        || String(c.email || "").toLowerCase().includes(q)
        || (qDigits && String(c.phone || "").replace(/\D/g, "").includes(qDigits)))
    : convos;

  return (
    <div className="h-full flex flex-col">
      <div className="anim-fade-up mb-4 flex items-center gap-3">
        <h1 className="font-display px-1 text-[20px] font-semibold sm:text-[24px]" style={{ color: "var(--ck-text-strong)" }}>Inbox</h1>
        {attentionCount > 0 && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 align-middle font-mono text-xs font-semibold tabular-nums" style={{ background: "var(--ck-accent-soft)", color: "var(--ck-accent)" }}>
            {attentionCount}
          </span>
        )}
      </div>

      {loading ? <div className="space-y-3"><div className="ui-skeleton h-20 !rounded-xl" /><div className="ui-skeleton h-20 !rounded-xl" /><div className="ui-skeleton h-20 !rounded-xl" /></div> : (
        <div className="anim-fade-up anim-d1 flex min-h-0 flex-1 flex-col gap-3 md:gap-4">
          <BotStatusBanner />
          <div className="flex min-h-0 flex-1 gap-3 md:gap-4">
            {/* Conversation list — hidden on mobile when a chat is selected */}
            <div className={`w-full md:w-72 shrink-0 flex flex-col ui-card overflow-hidden ${selected ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 border-b border-[var(--ck-border-subtle)] bg-[var(--ck-surface-sunken)] space-y-2">
                <div className="flex items-center justify-between">
                  <p className="ui-mono-label !text-[10px]">{attentionCount} need attention · {convos.length} total</p>
                  <button onClick={loadConvos} className="ui-btn ui-btn-ghost !h-7 !px-2.5 text-[11px]">Refresh</button>
                </div>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, number or email…"
                  className="ui-control w-full !h-8 px-2.5 text-[12.5px] rounded-lg outline-none"
                />
              </div>
              <div className="flex-1 overflow-auto">
                {visibleConvos.length === 0 ? (
                  <div className="ui-empty">
                    <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{q ? "No matches" : "No conversations yet"}</p>
                    <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>{q ? "Try a different name, number or email." : "WhatsApp and web-chat conversations will appear here."}</p>
                  </div>
                ) : visibleConvos.length > 50 ? (
                  <Virtuoso
                    style={{ height: "100%" }}
                    data={visibleConvos}
                    itemContent={(_, c: any) => (
                      <ConvoRow c={c} isSelected={selected?.id === c.id} onClick={() => setSelected(c)} />
                    )}
                  />
                ) : visibleConvos.map((c: any) => (
                  <ConvoRow key={c.id} c={c} isSelected={selected?.id === c.id} onClick={() => setSelected(c)} />
                ))}
              </div>
            </div>

            {/* Chat panel — full width on mobile */}
            {selected ? (
              <div className="flex-1 flex flex-col ui-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ck-border-subtle)] bg-[var(--ck-surface-sunken)] p-3">
                  <button onClick={() => setSelected(null)} className="ui-btn ui-btn-ghost md:hidden shrink-0 !h-8 !px-2.5 text-xs">
                    Back
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate" style={{ color: "var(--ck-text-strong)" }}>{selected.customer_name || selected.phone}</p>
                    <p className="text-xs truncate" style={{ color: "var(--ck-text-muted)" }}>{selected.phone} · {selected.email || "no email"}</p>
                  </div>
                  {needsAttention(selected) && (
                    <div className="flex w-full gap-2 sm:w-auto">
                      {/^web(:|$)/.test(String(selected.phone)) && (
                        <button onClick={() => endChat(selected.phone)}
                          className="ui-btn ui-btn-soft flex-1 !h-8 text-xs sm:flex-none">
                          End chat &amp; rate
                        </button>
                      )}
                      <button onClick={() => returnToBot(selected.id, selected.phone)}
                        className="ui-btn ui-btn-soft flex-1 !h-8 text-xs sm:flex-none">
                        Return to Bot
                      </button>
                    </div>
                  )}
                </div>

                {customerBookings.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto border-b border-[var(--ck-border-subtle)] px-3 py-2" style={{ background: "var(--ck-surface-sunken)" }}>
                    {customerBookings.map((b: any) => (
                      <Link key={b.id} href={`/bookings/${b.id}`}
                        className="shrink-0 rounded-lg border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] px-2.5 py-1.5 text-[11px] leading-tight transition-colors hover:border-[var(--ck-accent)]">
                        {/* Same 6-char ref the customer sees in /my-bookings, so both sides quote the same number */}
                        <span className="font-mono font-semibold" style={{ color: "var(--ck-text-strong)" }}>#{b.id.substring(0, 6).toUpperCase()}</span>
                        <span style={{ color: "var(--ck-text-muted)" }}> · {b.tours?.name || "Tour"} · {b.slots?.start_time ? fmtSlot(b.slots.start_time) : "no date"} · {b.status}</span>
                      </Link>
                    ))}
                  </div>
                )}

                <div className="flex-1 overflow-auto p-4 space-y-3" style={{ background: "var(--ck-surface-warm)" }}>
                  {messages.length === 0 ? (
                    <div className="ui-empty">
                      <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No messages yet</p>
                      <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>The customer&apos;s next message will appear here.</p>
                    </div>
                  ) : (
                    <MessageList messages={messages} endRef={chatEndRef} fmtTime={fmtTime} fmtDate={fmtDate} />
                  )}
                  {isTyping && (
                    <div className="flex justify-end">
                      <div className="flex items-center gap-1 rounded-2xl rounded-br-md px-3 py-2" style={{ background: "var(--ck-accent-soft)" }}>
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ck-accent)] [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ck-accent)] [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ck-accent)] [animation-delay:300ms]" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-[var(--ck-border-subtle)]" style={{ background: "var(--ck-surface)" }}>
                  {waWarning && (
                    <div className="flex items-start gap-2 border-b px-3 py-2" style={{ background: "var(--ck-amber-soft)", borderColor: "color-mix(in srgb, var(--ck-amber) 25%, transparent)" }}>
                      <span className="shrink-0 mt-0.5" style={{ color: "var(--ck-amber)" }}><Warning size={15} weight="fill" /></span>
                      <p className="flex-1 text-xs leading-snug" style={{ color: "var(--ck-amber)" }}>{waWarning}</p>
                      <button onClick={() => setWaWarning(null)} className="shrink-0 hover:opacity-70" style={{ color: "var(--ck-amber)" }} aria-label="Dismiss"><XIcon size={13} /></button>
                    </div>
                  )}
                  <div className="p-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <textarea value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={handleKeyDown}
                        rows={2} placeholder={needsAttention(selected) ? "Type your reply... (Enter to send)" : "Reply to take over from the bot... (Enter to send)"}
                        className="ui-control flex-1 resize-none outline-none" />
                      <button onClick={sendReply} disabled={sending || !reply.trim()}
                        className="ui-btn ui-btn-primary self-stretch !h-auto py-2.5 disabled:opacity-50 sm:self-end sm:!h-9 sm:!py-0">
                        {sending ? "..." : "Send"}
                      </button>
                    </div>
                    {!needsAttention(selected) && (
                      <p className="text-[10px] mt-2" style={{ color: "var(--ck-text-muted)" }}>This chat is being handled by the bot. Replying moves it to human handling.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="hidden md:flex flex-1 items-center justify-center ui-card">
                <div className="ui-empty">
                  <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No conversation selected</p>
                  <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Choose a conversation on the left to see its full history.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Inbox() {
  return (
    <Suspense fallback={<div className="p-8 text-center" style={{ color: "var(--ck-text-muted)" }}>Loading Inbox...</div>}>
      <InboxContent />
    </Suspense>
  );
}
