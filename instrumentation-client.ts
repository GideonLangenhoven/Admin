import * as Sentry from "@sentry/nextjs";
import { isAgentTelemetry } from "./app/lib/agent-telemetry";

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  debug: false,
  sendDefaultPii: false,
  initialScope: { tags: { app: "admin" } },
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
  ignoreErrors: [
    "Non-Error promise rejection captured",
    /^ResizeObserver loop/,
  ],
  beforeSendTransaction: event => isAgentTelemetry(event) ? null : event,
  beforeBreadcrumb: breadcrumb => isAgentTelemetry(breadcrumb) ? null : breadcrumb,
  beforeSend(event) {
    if (isAgentTelemetry(event)) return null;
    if (event.request) {
      delete event.request.cookies;
      delete event.request.data;
      delete event.request.query_string;
      event.request.headers = undefined;
      if (event.request.url) {
        try { const url = new URL(event.request.url); event.request.url = url.origin + url.pathname; } catch { event.request.url = undefined; }
      }
    }
    if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
    return event;
  },
});
