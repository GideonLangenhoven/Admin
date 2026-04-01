/**
 * Structured logger for edge functions.
 * Writes JSON to console AND persists warn/error to edge_function_logs table.
 *
 * Usage:
 *   import { createLogger } from "../_shared/logger.ts";
 *   const log = createLogger("yoco-webhook", supabase);
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
  /** Call at the end of request handling to persist a summary log entry. */
  flush: (durationMs?: number) => Promise<void>;
}

export function createLogger(functionName: string, supabase?: any): Logger {
  var correlationId = crypto.randomUUID().substring(0, 8);
  var entries: Array<{ level: LogLevel; message: string; ctx: LogContext; ts: string }> = [];

  function log(level: LogLevel, message: string, ctx: LogContext = {}) {
    var entry = {
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

    entries.push({ level, message, ctx, ts: entry.ts });
  }

  async function flush(durationMs?: number) {
    if (!supabase) return;
    // Persist warn/error entries to the database for monitoring
    var toInsert = entries
      .filter((e) => e.level === "warn" || e.level === "error")
      .map((e) => ({
        function_name: functionName,
        level: e.level,
        message: e.message,
        correlation_id: correlationId,
        business_id: e.ctx.business_id || null,
        booking_id: e.ctx.booking_id || null,
        duration_ms: durationMs || null,
        metadata: e.ctx,
      }));

    // Also persist a summary info entry if there were errors
    if (toInsert.length === 0 && durationMs !== undefined) {
      // No errors — just log a health heartbeat if the function took > 5s
      if (durationMs > 5000) {
        toInsert.push({
          function_name: functionName,
          level: "warn",
          message: "Slow execution: " + durationMs + "ms",
          correlation_id: correlationId,
          business_id: null,
          booking_id: null,
          duration_ms: durationMs,
          metadata: {},
        });
      }
    }

    if (toInsert.length > 0) {
      await supabase.from("edge_function_logs").insert(toInsert).catch((e: any) => {
        console.error("LOGGER_FLUSH_ERR:" + String(e));
      });
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
