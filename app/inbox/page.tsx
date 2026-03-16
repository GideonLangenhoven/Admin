"use client";
import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";

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
                <span className="bg-gray-200 text-gray-500 text-xs px-3 py-1 rounded-full">{fmtDate(m.created_at)}</span>
              </div>
            )}
            <div className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${isAdmin
                ? "bg-blue-600 text-white rounded-br-md"
                : "bg-white border border-gray-200 text-gray-900 rounded-bl-md"
                }`}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={`text-xs mt-1 ${isAdmin ? "text-blue-200" : "text-gray-400"}`}>
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
  const sendingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);
  const autoSelectedRef = useRef(false);

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

  async function loadConvos() {
    const { data } = await supabase.from("conversations")
      .select("id, phone, customer_name, email, status, current_state, updated_at")
      .eq("business_id", businessId)
      .in("status", ["HUMAN", "AGENT_PENDING"])
      .order("updated_at", { ascending: false });
    setConvos(data || []);
    setLoading(false);
  }

  async function loadHistoryConvos() {
    setHistoryLoading(true);
    const { data } = await supabase.from("conversations")
      .select("id, phone, customer_name, email, status, current_state, updated_at")
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
        body: { phone: target.phone, message: msg },
      });
      if (res.error) {
        notify({ title: "Reply failed", message: res.error.message, tone: "error" });
      } else if (res.data && res.data.ok === false) {
        let msgErr = res.data.error || "Unknown Error";
        if (res.data.details?.error?.error_data?.details) {
          msgErr += "\nDetails: " + res.data.details.error.error_data.details;
        } else if (res.data.details?.error?.message) {
          msgErr += "\nDetails: " + res.data.details.error.message;
        }
        notify({ title: "Reply failed", message: msgErr, tone: "error" });
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
        body: { action: "return_to_bot", phone: phone, message: "RETURN" },
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
      <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max items-center gap-3">
        <button
          onClick={() => setActiveTab("inbox")}
          className={`px-1 pb-0.5 text-xl font-bold border-b-2 transition-colors sm:text-2xl ${activeTab === "inbox"
            ? "border-blue-600 text-gray-900"
            : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
        >
          Inbox
          {convos.length > 0 && (
            <span className="ml-2 bg-blue-600 text-white text-xs font-bold rounded-full px-2 py-0.5 align-middle">
              {convos.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`px-1 pb-0.5 text-xl font-bold border-b-2 transition-colors whitespace-nowrap sm:text-2xl ${activeTab === "history"
            ? "border-blue-600 text-gray-900"
            : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
        >
          Chat History
        </button>
        </div>
      </div>

      {/* ── Inbox Tab ── */}
      {activeTab === "inbox" && (
        loading ? <p className="text-gray-500">Loading...</p> : (
          <div className="flex min-h-0 flex-1 gap-3 md:gap-4">
            {/* Conversation list — hidden on mobile when a chat is selected */}
            <div className={`w-full md:w-72 shrink-0 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden ${selected ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 border-b border-gray-200 bg-gray-50">
                <p className="text-sm font-medium text-gray-600">{convos.length} waiting</p>
              </div>
              <div className="flex-1 overflow-auto">
                {convos.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500 text-center">No conversations waiting ✓</p>
                ) : convos.map((c: any) => (
                  <div key={c.id} onClick={() => setSelected(c)}
                    className={`p-3 border-b border-gray-100 cursor-pointer transition-colors ${selected?.id === c.id ? "bg-blue-50 border-l-4 border-l-blue-500" : "hover:bg-gray-50"}`}>
                    <p className="font-semibold text-sm">{c.customer_name || "Unknown"}</p>
                    <p className="text-xs text-gray-500">{c.phone}</p>
                    <p className="text-xs text-gray-400 mt-1">{new Date(c.updated_at).toLocaleString("en-ZA", { timeZone: getAdminTimezone() })}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Chat panel — full width on mobile */}
            {selected ? (
              <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 p-3">
                  <button onClick={() => setSelected(null)} className="md:hidden shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium hover:bg-gray-50">
                    ← Back
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{selected.customer_name || selected.phone}</p>
                    <p className="text-xs text-gray-500 truncate">{selected.phone} · {selected.email || "no email"}</p>
                    <p className="mt-1 text-[10px] text-gray-400">Showing the active human handoff only. Earlier bot context stays hidden.</p>
                  </div>
                  <button onClick={() => returnToBot(selected.id, selected.phone)}
                    className="w-full rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 sm:w-auto">
                    Return to Bot
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-3 bg-gray-50">
                  {messages.length === 0 ? (
                    <p className="text-center text-gray-400 text-sm mt-8">No messages yet. The customer&apos;s next message will appear here.</p>
                  ) : (
                    <MessageList messages={messages} endRef={chatEndRef} fmtTime={fmtTime} fmtDate={fmtDate} />
                  )}
                </div>

                <div className="p-3 border-t border-gray-200 bg-white">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <textarea value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={handleKeyDown}
                      rows={2} placeholder="Type your reply... (Enter to send)"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                    <button onClick={sendReply} disabled={sending || !reply.trim()}
                      className="self-stretch rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 sm:self-end">
                      {sending ? "..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="hidden md:flex flex-1 items-center justify-center bg-white rounded-xl border border-gray-200">
                <p className="text-gray-400">Select a conversation to start chatting</p>
              </div>
            )}
          </div>
        )
      )}

      {/* ── Chat History Tab ── */}
      {activeTab === "history" && (
        historyLoading ? <p className="text-gray-500">Loading...</p> : (
          <div className="flex-1 flex gap-4 min-h-0">
            {/* Past conversation list — hidden on mobile when a chat is selected */}
            <div className={`w-full md:w-72 shrink-0 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden ${historySelected ? "hidden md:flex" : "flex"}`}>
              <div className="p-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-600">{historyConvos.length} conversations</p>
                <button onClick={loadHistoryConvos} className="text-xs text-blue-600 hover:underline">Refresh</button>
              </div>
              <div className="flex-1 overflow-auto">
                {historyConvos.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500 text-center">No chat history yet</p>
                ) : historyConvos.map((c: any) => (
                  <div key={c.id} onClick={() => { setHistorySelected(c); loadHistoryMessages(c.phone); }}
                    className={`p-3 border-b border-gray-100 cursor-pointer transition-colors ${historySelected?.id === c.id ? "bg-blue-50 border-l-4 border-l-blue-500" : "hover:bg-gray-50"}`}>
                    <p className="font-semibold text-sm">{c.customer_name || "Unknown"}</p>
                    <p className="text-xs text-gray-500">{c.phone}</p>
                    <p className="text-xs text-gray-400 mt-1">{new Date(c.updated_at).toLocaleString("en-ZA", { timeZone: getAdminTimezone() })}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Read-only transcript — full width on mobile */}
            {historySelected ? (
              <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
                  <button onClick={() => setHistorySelected(null)} className="md:hidden shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium hover:bg-gray-50">
                    ← Back
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{historySelected.customer_name || historySelected.phone}</p>
                    <p className="text-xs text-gray-500 truncate">{historySelected.phone} · {historySelected.email || "no email"} · {historySelected.status}</p>
                    <p className="mt-1 text-[10px] text-gray-400">Transcript is intentionally trimmed to the human handoff view.</p>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4 space-y-3 bg-gray-50">
                  {historyMessages.length === 0 ? (
                    <p className="text-center text-gray-400 text-sm mt-8">No messages in this conversation</p>
                  ) : (
                    <MessageList messages={historyMessages} endRef={historyChatEndRef} fmtTime={fmtTime} fmtDate={fmtDate} />
                  )}
                </div>

                {/* Reply box in history allows taking over */}
                <div className="p-4 border-t border-gray-200 bg-white">
                  <div className="flex gap-2">
                    <input type="text" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendReply(historySelected)} placeholder="Reply to take over..." className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                    <button onClick={() => sendReply(historySelected)} disabled={sending || !reply.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-400">
                      {sending ? "..." : "Reply"}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2">Replying will move this conversation to your active Inbox.</p>
                </div>
              </div>
            ) : (
              <div className="hidden md:flex flex-1 items-center justify-center bg-white rounded-xl border border-gray-200">
                <p className="text-gray-400">Select a conversation to view transcript</p>
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
    <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading Inbox...</div>}>
      <InboxContent />
    </Suspense>
  );
}
