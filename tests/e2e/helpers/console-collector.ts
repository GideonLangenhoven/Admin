import type { ConsoleMessage, Page } from "@playwright/test";

export interface ConsoleLogEntry {
  type: string;
  text: string;
  location: ConsoleMessage["location"];
}

export function collectConsoleLogs(page: Page): ConsoleLogEntry[] {
  const logs: ConsoleLogEntry[] = [];

  page.on("console", (message) => {
    logs.push({
      type: message.type(),
      text: message.text(),
      location: message.location,
    });
  });

  page.on("pageerror", (error) => {
    logs.push({
      type: "error",
      text: error.message,
      location: () => ({ url: "", lineNumber: 0, columnNumber: 0 }),
    });
  });

  return logs;
}

export function hasTrace(logs: ConsoleLogEntry[], needle: string): boolean {
  return logs.some((entry) => entry.text.includes(needle));
}

export function filterLogs(logs: ConsoleLogEntry[], needle: string): ConsoleLogEntry[] {
  return logs.filter((entry) => entry.text.includes(needle));
}
