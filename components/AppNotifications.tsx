"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Warning, CheckCircle, Info, X } from "@phosphor-icons/react";
import {
  registerAppNotifications,
  unregisterAppNotifications,
  type AppConfirmPayload,
  type AppNoticePayload,
  type AppNoticeTone,
} from "../app/lib/app-notify";

type NoticeItem = AppNoticePayload & {
  id: string;
};

type ConfirmState = AppConfirmPayload & {
  resolve: (value: boolean) => void;
};

const TONE_STYLES: Record<AppNoticeTone, { card: string; icon: string; Icon: typeof Info }> = {
  info: { card: "border-sky-200 bg-sky-50 text-sky-900", icon: "text-sky-600", Icon: Info },
  success: { card: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: "text-emerald-600", Icon: CheckCircle },
  warning: { card: "border-amber-200 bg-amber-50 text-amber-900", icon: "text-amber-600", Icon: Warning },
  error: { card: "border-red-200 bg-red-50 text-red-900", icon: "text-red-600", Icon: Warning },
};

export default function AppNotifications() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const timeoutsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const nativeAlert = window.alert.bind(window);
    registerAppNotifications({
      notify(payload) {
        const id = Math.random().toString(36).slice(2);
        const notice = {
          id,
          tone: "info" as AppNoticeTone,
          duration: 5000,
          ...payload,
        };
        setNotices((current) => [...current, notice]);
        const duration = Math.max(notice.duration || 5000, 1500);
        timeoutsRef.current[id] = window.setTimeout(() => {
          setNotices((current) => current.filter((item) => item.id !== id));
          delete timeoutsRef.current[id];
        }, duration);
      },
      confirm(payload) {
        return new Promise<boolean>((resolve) => {
          setConfirmState({ ...payload, resolve });
        });
      },
    });

    window.alert = (message?: unknown) => {
      const text = typeof message === "string" ? message : String(message ?? "");
      const tone: AppNoticeTone =
        /failed|error|could not|no /i.test(text) ? "error" :
        /success|created|sent|updated|complete|copied/i.test(text) ? "success" :
        "info";
      const title =
        tone === "error" ? "Action failed" :
        tone === "success" ? "Done" :
        "Notice";
      const id = Math.random().toString(36).slice(2);
      const notice = { id, title, message: text, tone, duration: 6000 };
      setNotices((current) => [...current, notice]);
      timeoutsRef.current[id] = window.setTimeout(() => {
        setNotices((current) => current.filter((item) => item.id !== id));
        delete timeoutsRef.current[id];
      }, notice.duration);
    };

    return () => {
      Object.values(timeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
      window.alert = nativeAlert;
      unregisterAppNotifications();
    };
  }, []);

  function dismissNotice(id: string) {
    if (timeoutsRef.current[id]) {
      window.clearTimeout(timeoutsRef.current[id]);
      delete timeoutsRef.current[id];
    }
    setNotices((current) => current.filter((item) => item.id !== id));
  }

  function resolveConfirm(value: boolean) {
    if (!confirmState) return;
    confirmState.resolve(value);
    setConfirmState(null);
  }

  const renderedNotices = useMemo(() => notices.slice(-4), [notices]);

  return (
    <>
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-3">
        {renderedNotices.map((notice) => {
          const tone = notice.tone || "info";
          const style = TONE_STYLES[tone];
          const Icon = style.Icon;
          return (
            <div key={notice.id} className={`pointer-events-auto rounded-2xl border p-4 shadow-lg backdrop-blur ${style.card}`}>
              <div className="flex items-start gap-3">
                <Icon className={`mt-0.5 shrink-0 ${style.icon}`} size={18} />
                <div className="min-w-0 flex-1">
                  {notice.title && <p className="text-sm font-semibold">{notice.title}</p>}
                  <p className="text-sm leading-6">{notice.message}</p>
                </div>
                <button type="button" onClick={() => dismissNotice(notice.id)} className="rounded-full p-1 text-current/60 transition hover:bg-white/40 hover:text-current">
                  <X size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {confirmState && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[101] flex justify-center px-4">
          <div className={`pointer-events-auto w-full max-w-2xl rounded-3xl border p-5 shadow-2xl ${TONE_STYLES[confirmState.tone || "warning"].card}`}>
            <div className="flex items-start gap-3">
              <Warning className={`mt-0.5 shrink-0 ${TONE_STYLES[confirmState.tone || "warning"].icon}`} size={20} />
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">{confirmState.title || "Please confirm"}</p>
                <p className="mt-1 text-sm leading-6">{confirmState.message}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => resolveConfirm(true)}
                    className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                  >
                    {confirmState.confirmLabel || "Confirm"}
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveConfirm(false)}
                    className="rounded-xl border border-current/15 bg-white/60 px-4 py-2 text-sm font-semibold text-current hover:bg-white"
                  >
                    {confirmState.cancelLabel || "Cancel"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
