"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Warning, CheckCircle, Info, X } from "@phosphor-icons/react";
import {
  registerAppNotifications,
  unregisterAppNotifications,
  type AppConfirmPayload,
  type AppConfirmResult,
  type AppNoticePayload,
  type AppNoticeTone,
} from "../app/lib/app-notify";

type NoticeItem = AppNoticePayload & {
  id: string;
};

type ConfirmState = AppConfirmPayload & {
  resolve: (value: AppConfirmResult) => void;
};

/* Field Console toasts: ui-card chrome + a 3px tone rail, icon in a soft chip */
const TONE_STYLES: Record<AppNoticeTone, { rail: string; chipBg: string; chipFg: string; Icon: typeof Info }> = {
  info: { rail: "var(--ck-ocean)", chipBg: "var(--ck-ocean-soft)", chipFg: "var(--ck-ocean)", Icon: Info },
  success: { rail: "var(--ck-success)", chipBg: "var(--ck-success-soft)", chipFg: "var(--ck-success)", Icon: CheckCircle },
  warning: { rail: "var(--ck-warning)", chipBg: "var(--ck-warning-soft)", chipFg: "var(--ck-warning)", Icon: Warning },
  error: { rail: "var(--ck-danger)", chipBg: "var(--ck-danger-soft)", chipFg: "var(--ck-danger)", Icon: Warning },
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
        return new Promise<AppConfirmResult>((resolve) => {
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

  function resolveConfirm(value: AppConfirmResult) {
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
            <div key={notice.id} className="ui-card anim-fade-up pointer-events-auto relative overflow-hidden p-4" style={{ boxShadow: "var(--ck-shadow-lg)" }}>
              <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: style.rail }} aria-hidden="true" />
              <div className="flex items-start gap-3">
                <span className="ui-icon-chip !h-8 !w-8 !rounded-lg" style={{ background: style.chipBg, color: style.chipFg }}>
                  <Icon size={17} weight="fill" />
                </span>
                <div className="min-w-0 flex-1">
                  {notice.title && <p className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{notice.title}</p>}
                  <p className="text-sm leading-6" style={{ color: "var(--ck-text)" }}>{notice.message}</p>
                </div>
                <button type="button" onClick={() => dismissNotice(notice.id)} className="rounded-full p-1 transition hover:bg-[var(--ck-surface-sunken)]" style={{ color: "var(--ck-text-muted)" }}>
                  <X size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {confirmState && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[101] flex justify-center px-4">
          <div className="ui-card anim-fade-up pointer-events-auto relative w-full max-w-2xl overflow-hidden p-5" style={{ boxShadow: "var(--ck-shadow-lg)" }}>
            <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: TONE_STYLES[confirmState.tone || "warning"].rail }} aria-hidden="true" />
            <div className="flex items-start gap-3">
              <span className="ui-icon-chip shrink-0" style={{ background: TONE_STYLES[confirmState.tone || "warning"].chipBg, color: TONE_STYLES[confirmState.tone || "warning"].chipFg }}>
                <Warning size={19} weight="fill" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>{confirmState.title || "Please confirm"}</p>
                <p className="mt-1 text-sm leading-6" style={{ color: "var(--ck-text)" }}>{confirmState.message}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => resolveConfirm(true)}
                    className={`ui-btn ${confirmState.tone === "error" || confirmState.tone === "warning" ? "ui-btn-danger" : "ui-btn-primary"}`}
                  >
                    {confirmState.confirmLabel || "Confirm"}
                  </button>
                  {confirmState.altLabel && (
                    <button
                      type="button"
                      onClick={() => resolveConfirm("alt")}
                      className="ui-btn ui-btn-soft"
                    >
                      {confirmState.altLabel}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => resolveConfirm(false)}
                    className="ui-btn ui-btn-ghost"
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
