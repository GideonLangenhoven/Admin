export type AppNoticeTone = "info" | "success" | "warning" | "error";

export type AppNoticePayload = {
  title?: string;
  message: string;
  tone?: AppNoticeTone;
  duration?: number;
};

export type AppConfirmPayload = {
  title?: string;
  message: string;
  tone?: AppNoticeTone;
  confirmLabel?: string;
  cancelLabel?: string;
  altLabel?: string;
};

export type AppConfirmResult = boolean | "alt";

let notifyHandler: ((payload: AppNoticePayload) => void) | null = null;
let confirmHandler: ((payload: AppConfirmPayload) => Promise<AppConfirmResult>) | null = null;

export function registerAppNotifications(handlers: {
  notify: (payload: AppNoticePayload) => void;
  confirm: (payload: AppConfirmPayload) => Promise<AppConfirmResult>;
}) {
  notifyHandler = handlers.notify;
  confirmHandler = handlers.confirm;
}

export function unregisterAppNotifications() {
  notifyHandler = null;
  confirmHandler = null;
}

export function notify(payload: string | AppNoticePayload) {
  const normalized = typeof payload === "string" ? { message: payload } : payload;
  if (notifyHandler) {
    notifyHandler(normalized);
    return;
  }
  if (typeof window !== "undefined") {
    console.warn("App notification emitted before notification layer mounted:", normalized);
  }
}

export async function confirmAction(payload: string | AppConfirmPayload): Promise<AppConfirmResult> {
  const normalized = typeof payload === "string" ? { message: payload } : payload;
  if (confirmHandler) {
    return confirmHandler(normalized);
  }
  if (typeof window !== "undefined") {
    console.warn("App confirmation requested before notification layer mounted:", normalized);
  }
  return false;
}
