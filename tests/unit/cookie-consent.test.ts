import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readConsent, saveConsent } from "../../booking/app/lib/cookie-consent";

// Round 2, R5: optional performance tracing runs only after the visitor
// accepts it in the cookie banner.
function storage(values: Record<string, string>) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
  });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe("cookie consent", () => {
  it("reads the visitor's choice, and nothing before one", () => {
    expect(readConsent(), "no storage at all").toBe(null);
    storage({});
    expect(readConsent()).toBe(null);
    storage({ "cookie-consent": "all" });
    expect(readConsent()).toBe("all");
    storage({ "cookie-consent": "essential" });
    expect(readConsent()).toBe("essential");
    storage({ "cookie-consent": "yes please" });
    expect(readConsent()).toBe(null);
  });

  it("treats the old banner's OK as essential only", () => {
    storage({ "cookie-consent-accepted": "true" });
    expect(readConsent()).toBe("essential");
  });

  it("saves the choice", () => {
    const values = storage({});
    saveConsent("all");
    expect(values["cookie-consent"]).toBe("all");
  });

  it("samples Sentry traces only with consent to all", () => {
    const source = readFileSync("booking/instrumentation-client.ts", "utf8");
    expect(source).not.toMatch(/tracesSampleRate/);
    expect(source).toMatch(/tracesSampler: \(\) => \(readConsent\(\) === "all" \? .+ : 0\)/);
  });
});
