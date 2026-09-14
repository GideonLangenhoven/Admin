/**
 * Structured logger for edge functions. Writes JSON to console, which the
 * Supabase log drain picks up and which `get_logs` queries.
 *
 * It used to also persist warn/error rows to an `edge_function_logs` table.
 * No such table exists, so every one of those inserts was rejected and the
 * .catch() swallowed it — the persistence half never worked. Removed rather
 * than backed by a new table: Supabase already retains function logs, a second
 * copy in Postgres would grow unbounded, and nothing imports this module yet.
 *
 * Usage:
 *   import { createLogger } from "../_shared/logger.ts";
 *   const log = createLogger("yoco-webhook");
 *   log.info("Payment received", { booking_id, amount });
 *   log.error("Refund failed", { booking_id, error: err.message });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  business_id?: string;
  booking_id?: string;
  [key: string]: unknown;
}

export interface Logger {
  correlationId: string;
  debug: (message: string, ctx?: LogContext) => void;
  info: (message: string, ctx?: LogContext) => void;
  warn: (message: string, ctx?: LogContext) => void;
  error: (message: string, ctx?: LogContext) => void;
  /** Call at the end of request handling; logs a warning if it ran long. */
  flush: (durationMs?: number) => Promise<void>;
}

export function createLogger(functionName: string): Logger {
  const correlationId = crypto.randomUUID().substring(0, 8);

  function log(level: LogLevel, message: string, ctx: LogContext = {}) {
    const entry = {
      ts: new Date().toISOString(),
      fn: functionName,
      cid: correlationId,
      level,
      msg: message,
      ...ctx,
    };
    // Structured JSON to console (picked up by Supabase log drain)
    if (level === "error") console.error(JSON.stringify(entry));
    else if (level === "warn") console.warn(JSON.stringify(entry));
    else console.log(JSON.stringify(entry));
  }

  // Kept so callers can record wall-clock at the end of a request. Console
  // only — see the note above about the removed table write.
  async function flush(durationMs?: number) {
    if (durationMs !== undefined && durationMs > 5000) {
      log("warn", "Slow execution: " + durationMs + "ms", { duration_ms: durationMs });
    }
  }

  return {
    correlationId,
    debug: (msg: string, ctx?: LogContext) => log("debug", msg, ctx),
    info: (msg: string, ctx?: LogContext) => log("info", msg, ctx),
    warn: (msg: string, ctx?: LogContext) => log("warn", msg, ctx),
    error: (msg: string, ctx?: LogContext) => log("error", msg, ctx),
    flush,
  };
}
