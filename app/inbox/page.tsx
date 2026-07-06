"use client";
import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import IntentBadge from "../../components/inbox/IntentBadge";
import { Virtuoso } from "react-virtuoso";
import BotStatusBanner from "./components/BotStatusBanner";
import { ChatCircleDots, ChatsCircle, PaperPlaneTilt, ArrowLeft, Robot, ArrowClockwise, Warning, CheckCircle, X as XIcon } from "@phosphor-icons/react";

function filterHumanConversation(all: any[]): any[] {
  const firstAdminIdx = all.findIndex(m => m.sender === "Admin");

  if (firstAdminIdx === -1) {
    // No admin turn yet — show just the last customer message as context
    return all.filter(m => m.direction === "IN").slice(-1);
  }

  // 1 message immediately before the first admin reply as context,
  // then all human messages (customer IN + admin OUT) from that point on
  const contextIdx = Math.max(0, firstAdminIdx - 1);
  const context = contextIdx < firstAdminIdx ? [all[contextIdx]] : [];
  const human = all
    .slice(firstAdminIdx)
    .filter(m => m.direction === "IN" || m.sender === "Admin");
  return [...context, ...human];
}

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
  const filtered = filterHumanConversation(messages);
  return (
    <>
      {filtered.map((m: any, i: number, arr: any[]) => {
        const isAdmin = m.direction === "OUT";
        const showDate = i === 0 || fmtDate(m.created_at) !== fmtDate(arr[i - 1].created_at);
        return (
          <div key={m.id}>
            {showDate && (
              <div className="text-center my-2">
                <span className="font-mono text-[11px] px-3 py-1 rounded-full" style={{ background: "var(--ck-surface-sunken)", color: "var(--ck-text-muted)" }}>{fmtDate(m.created_at)}</span>
              </div>
            )}
            <div className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${isAdmin
                ? "bg-[var(--ck-accent-soft)] text-[var(--ck-text-strong)] rounded-br-md"
                : "bg-[var(--ck-surface-sunken)] border border-[var(--ck-border-subtle)] text-[var(--ck-text)] rounded-bl-md"
                }`}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="text-xs mt-1" style={{ color: "var(--ck-text-muted)" }}>
                  {fmtTime(m.created_at)} · {m.sender || (isAdmin ? "Admin" : "Customer")}
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

function InboxContent() {
  const { businessId } = useBusinessContext();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"inbox" | "history">("inbox");

  // Inbox state
  const [convos, setConvos] = useState<any[]>([]);
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

  // Chat History state
  const [historyConvos, setHistoryConvos] = useState<any[]>([]);
  const [historySelected, setHistorySelected] = useState<any>(null);
  const [historyMessages, setHistoryMessages] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyLoadedRef = useRef(false);
  const historyChatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadConvos(); }, [businessId]);

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

  useEffect(() => {
    if (activeTab === "history" && !historyLoadedRef.current) {
      loadHistoryConvos();
    }
  }, [activeTab]);

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
      }, (payload: any) => {
        if (payload.new.phone === selected.phone) {
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
  }, [selected]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    historyChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [historyMessages]);

  // Polling fallback for inbox
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

  async function loadConvos() {
    // Cap at 200 — anything beyond is paginated history (loaded via the History tab)
    const { data } = await supabase.from("conversations")
      .select("id, phone, customer_name, email, status, current_state, updated_at, current_intent")
      .eq("business_id", businessId)
      .in("status", ["HUMAN", "AGENT_PENDING"])
      .order("updated_at", { ascending: false })
      .limit(200);
    setConvos(data || []);
    setLoading(false);
  }

  async function loadHistoryConvos() {
    setHistoryLoading(true);
    const { data } = await supabase.from("conversations")
      .select("id, phone, customer_name, email, status, current_state, updated_at, current_intent")
      .eq("business_id", businessId)
      .not("status", "in", '("HUMAN", "AGENT_PENDING")')
      .order("updated_at", { ascending: false })
      .limit(500);
    setHistoryConvos(data || []);
    setHistoryLoading(false);
    historyLoadedRef.current = true;
  }

  async function loadMessages(phone: string) {
    const { data } = await supabase.from("chat_messages")
      .select("*")
      .eq("business_id", businessId)
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1000);
    setMessages((data || []).reverse());
  }

  async function loadHistoryMessages(phone: string) {
    const { data } = await supabase.from("chat_messages")
      .select("*")
      .eq("business_id", businessId)
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(1000);
    setHistoryMessages((data || []).reverse());
  }

  async function sendReply(convoOverride?: any) {
    const target = convoOverride || selected;
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
          let msgErr = res.data.error || "Unknown Error";
          if (res.data.details?.error?.error_data?.details) {
            msgErr += "\nDetails: " + res.data.details.error.error_data.details;
          } else if (res.data.details?.error?.message) {
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
        
        if (target.status !== "HUMAN") {
          if (convoOverride) {
            setActiveTab("inbox");
            setSelected({ ...target, status: "HUMAN" });
            loadConvos();
            loadHistoryConvos();
          }
        }
        setReply("");
        notify({ title: "Reply sent", message: "The conversation remains in human handoff mode.", tone: "success" });
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
        loadHistoryConvos();
        notify({ title: "Returned to bot", message: "The conversation was handed back to the bot.", tone: "success" });
      }
    } catch (err: any) {
      notify({ title: "Return to bot failed", message: err.message, tone: "error" });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendingRef.current) {
        sendReply(activeTab === "history" ? historySelected : selected);
      }
    }
  }

  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: getAdminTimezone() });
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab header */}
      <div className="anim-fade-up -mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max items-center gap-3">
        <button
          onClick={() => setActiveTab("inbox")}
          className={`font-display px-1 pb-1 text-[20px] font-semibold border-b-2 transition-colors sm:text-[24px] ${activeTab === "inbox"
            ? "border-[var(--ck-accent)] text-[var(--ck-text-strong)]"
            : "border-transparent text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
            }`}
        >
          Inbox
          {convos.length > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 align-middle font-mono text-xs font-semibold tabular-nums" style={{ background: "var(--ck-accent-soft)", color: "var(--ck-accent)" }}>
              {convos.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`font-display px-1 pb-1 text-[20px] font-semibold border-b-2 transition-colors whitespace-nowrap sm:text-[24px] ${activeTab === "history"
            ? "border-[var(--ck-accent)] text-[var(--ck-text-strong)]"
            : "border-transparent text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
            }`}
        >
          Chat History
        </button>
        </div>
      </div>

      {/* ── Inbox Tab ── */}
      {activeTab === "inbox" && (
        loading ? <div className="space-y-3"><div className="ui-skeleton h-20 !rounded-xl" /><div className="ui-skeleton h-20 !rounded-xl" /><div className="ui-skeleton h-20 !rounded-xl" /></div> : (
          <div className="anim-fade-up anim-d1 flex min-h-0 flex-1 flex-col gap-3 md:gap-4">
          <BotStatusBanner />
          <div className="flex min-h-0 flex-1 gap-3 md:gap-4">
            {/* Conversation list — hidden on mobile when a chat is selected */}
            <div className={`w-full md:w-72 shrink-0 flex flex-col ui-card overflow-hidden ${selected ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 border-b border-[var(--ck-border-subtle)] bg-[var(--ck-surface-sunken)]">
                <p className="ui-mono-label !text-[10px]">{convos.length} waiting</p>
              </div>
              <div className="flex-1 overflow-auto">
                {convos.length === 0 ? (
                  <div className="ui-empty">
                    <span className="ui-icon-chip"><CheckCircle size={19} /></span>
                    <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>All caught up</p>
                    <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>No conversations waiting for a reply.</p>
                  </div>
                ) : convos.length > 50 ? (
                  <Virtuoso
                    style={{ height: "100%" }}
                    data={convos}
                    itemContent={(_, c: any) => (
                      <div onClick={() => setSelected(c)}
                        className={`p-3 border-b border-[var(--ck-border-subtle)] cursor-pointer transition-colors ${selected?.id === c.id ? "bg-[var(--ck-accent-soft)] border-l-4 border-l-[var(--ck-accent)]" : "hover:bg-[var(--ck-surface-sunken)]"}`}>
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ck-accent)]" aria-hidden="true" />
                          <p className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>{c.customer_name || "Unknown"}</p>
                          <IntentBadge intent={c.current_intent} size="xs" />
                        </div>
                        <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{c.phone}</p>
                        <p className="font-mono text-[11px] mt-1" style={{ color: "var(--ck-text-muted)" }}>{new Date(c.updated_at).toLocaleString("en-ZA", { timeZone: getAdminTimezone() })}</p>
                      </div>
                    )}
                  />
                ) : convos.map((c: any) => (
                  <div key={c.id} onClick={() => setSelected(c)}
                    className={`p-3 border-b border-[var(--ck-border-subtle)] cursor-pointer transition-colors ${selected?.id === c.id ? "bg-[var(--ck-accent-soft)] border-l-4 border-l-[var(--ck-accent)]" : "hover:bg-[var(--ck-surface-sunken)]"}`}>
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ck-accent)]" aria-hidden="true" />
                      <p className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>{c.customer_name || "Unknown"}</p>
                      <IntentBadge intent={c.current_intent} size="xs" />
                    </div>
                    <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{c.phone}</p>
                    <p className="font-mono text-[11px] mt-1" style={{ color: "var(--ck-text-muted)" }}>{new Date(c.updated_at).toLocaleString("en-ZA", { timeZone: getAdminTimezone() })}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Chat panel — full width on mobile */}
            {selected ? (
              <div className="flex-1 flex flex-col ui-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ck-border-subtle)] bg-[var(--ck-surface-sunken)] p-3">
                  <button onClick={() => setSelected(null)} className="ui-btn ui-btn-ghost md:hidden shrink-0 !h-8 !px-2.5 text-xs">
                    <ArrowLeft size={14} /> Back
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate" style={{ color: "var(--ck-text-strong)" }}>{selected.customer_name || selected.phone}</p>
                    <p className="text-xs truncate" style={{ color: "var(--ck-text-muted)" }}>{selected.phone} · {selected.email || "no email"}</p>
                    <p className="mt-1 text-[10px]" style={{ color: "var(--ck-text-muted)" }}>Showing the active human handoff only. Earlier bot context stays hidden.</p>
                  </div>
                  <button onClick={() => returnToBot(selected.id, selected.phone)}
                    className="ui-btn ui-btn-soft w-full !h-8 text-xs sm:w-auto">
                    <Robot size={14} /> Return to Bot
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-3" style={{ background: "var(--ck-surface-warm)" }}>
                  {messages.length === 0 ? (
                    <div className="ui-empty">
                      <span className="ui-icon-chip"><ChatCircleDots size={19} /></span>
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
                        rows={2} placeholder="Type your reply... (Enter to send)"
                        className="ui-control flex-1 resize-none outline-none" />
                      <button onClick={sendReply} disabled={sending || !reply.trim()}
                        className="ui-btn ui-btn-primary self-stretch !h-auto py-2.5 disabled:opacity-50 sm:self-end sm:!h-9 sm:!py-0">
                        <PaperPlaneTilt size={15} weight="fill" /> {sending ? "..." : "Send"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="hidden md:flex flex-1 items-center justify-center ui-card">
                <div className="ui-empty">
                  <span className="ui-icon-chip"><ChatCircleDots size={19} /></span>
                  <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No conversation selected</p>
                  <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Choose a conversation on the left to start chatting.</p>
                </div>
              </div>
            )}
          </div>
          </div>
        )
      )}

      {/* ── Chat History Tab ── */}
      {activeTab === "history" && (
        historyLoading ? <div className="space-y-3"><div className="ui-skeleton h-20 !rounded-xl" /><div className="ui-skeleton h-20 !rounded-xl" /><div className="ui-skeleton h-20 !rounded-xl" /></div> : (
          <div className="anim-fade-up anim-d1 flex-1 flex gap-4 min-h-0">
            {/* Past conversation list — hidden on mobile when a chat is selected */}
            <div className={`w-full md:w-72 shrink-0 flex flex-col ui-card overflow-hidden ${historySelected ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 border-b border-[var(--ck-border-subtle)] bg-[var(--ck-surface-sunken)] flex items-center justify-between">
                <p className="ui-mono-label !text-[10px]">{historyConvos.length} conversations</p>
                <button onClick={loadHistoryConvos} className="ui-btn ui-btn-ghost !h-7 !px-2.5 text-[11px]"><ArrowClockwise size={13} /> Refresh</button>
              </div>
              <div className="flex-1 overflow-auto">
                {historyConvos.length === 0 ? (
                  <div className="ui-empty">
                    <span className="ui-icon-chip"><ChatsCircle size={19} /></span>
                    <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No chat history yet</p>
                    <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Resolved conversations will show up here.</p>
                  </div>
                ) : historyConvos.map((c: any) => (
                  <div key={c.id} onClick={() => { setHistorySelected(c); loadHistoryMessages(c.phone); }}
                    className={`p-3 border-b border-[var(--ck-border-subtle)] cursor-pointer transition-colors ${historySelected?.id === c.id ? "bg-[var(--ck-accent-soft)] border-l-4 border-l-[var(--ck-accent)]" : "hover:bg-[var(--ck-surface-sunken)]"}`}>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>{c.customer_name || "Unknown"}</p>
                      <IntentBadge intent={c.current_intent} size="xs" />
                    </div>
                    <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{c.phone}</p>
                    <p className="font-mono text-[11px] mt-1" style={{ color: "var(--ck-text-muted)" }}>{new Date(c.updated_at).toLocaleString("en-ZA", { timeZone: getAdminTimezone() })}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Read-only transcript — full width on mobile */}
            {historySelected ? (
              <div className="flex-1 flex flex-col ui-card overflow-hidden">
                <div className="p-3 border-b border-[var(--ck-border-subtle)] bg-[var(--ck-surface-sunken)] flex items-center gap-2">
                  <button onClick={() => setHistorySelected(null)} className="ui-btn ui-btn-ghost md:hidden shrink-0 !h-8 !px-2.5 text-xs">
                    <ArrowLeft size={14} /> Back
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate" style={{ color: "var(--ck-text-strong)" }}>{historySelected.customer_name || historySelected.phone}</p>
                    <p className="text-xs truncate" style={{ color: "var(--ck-text-muted)" }}>{historySelected.phone} · {historySelected.email || "no email"} · {historySelected.status}</p>
                    <p className="mt-1 text-[10px]" style={{ color: "var(--ck-text-muted)" }}>Transcript is intentionally trimmed to the human handoff view.</p>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4 space-y-3" style={{ background: "var(--ck-surface-warm)" }}>
                  {historyMessages.length === 0 ? (
                    <div className="ui-empty">
                      <span className="ui-icon-chip"><ChatCircleDots size={19} /></span>
                      <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No messages in this conversation</p>
                      <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Nothing was exchanged in this thread.</p>
                    </div>
                  ) : (
                    <MessageList messages={historyMessages} endRef={historyChatEndRef} fmtTime={fmtTime} fmtDate={fmtDate} />
                  )}
                </div>

                {/* Reply box in history allows taking over */}
                <div className="p-4 border-t border-[var(--ck-border-subtle)]" style={{ background: "var(--ck-surface)" }}>
                  <div className="flex gap-2">
                    <input type="text" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendReply(historySelected)} placeholder="Reply to take over..." className="ui-control flex-1 outline-none" />
                    <button onClick={() => sendReply(historySelected)} disabled={sending || !reply.trim()} className="ui-btn ui-btn-primary !h-9 disabled:opacity-50">
                      <PaperPlaneTilt size={15} weight="fill" /> {sending ? "..." : "Reply"}
                    </button>
                  </div>
                  <p className="text-[10px] mt-2" style={{ color: "var(--ck-text-muted)" }}>Replying will move this conversation to your active Inbox.</p>
                </div>
              </div>
            ) : (
              <div className="hidden md:flex flex-1 items-center justify-center ui-card">
                <div className="ui-empty">
                  <span className="ui-icon-chip"><ChatCircleDots size={19} /></span>
                  <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No conversation selected</p>
                  <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Choose a conversation on the left to view its transcript.</p>
                </div>
              </div>
            )}
          </div>
        )
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
