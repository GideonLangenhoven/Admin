import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reported live: clicking a link in the help assistant (an "Email Marketing"
// source chip, route /marketing) closed the assistant mid-conversation — it
// read as the bot quitting on you. Both the inline answer links and the source
// chips called setOpen(false) unconditionally.
//
// The panel only needs to move on mobile, where it is a bottom sheet over
// 75dvh covering the page you just asked to see. On desktop it is a 380px
// corner card that obscures nothing.
const SRC = readFileSync("components/HelpChat.tsx", "utf8");

describe("help assistant survives following its own links", () => {
  it("routes every navigation through the shared handler", () => {
    expect(SRC).toContain("function handleNavigate()");
    expect(SRC).toContain("onNavigate={handleNavigate}");
    expect(SRC).toContain("onClick={handleNavigate}");
    // The unconditional close is what caused the report. Scoped to the links:
    // the header's X button uses the same inline form and SHOULD always close.
    expect(SRC).not.toContain("onNavigate={() => setOpen(false)}");
    const chip = SRC.slice(SRC.indexOf("m.sources!.map"), SRC.indexOf("{busy &&"));
    expect(chip).toContain("onClick={handleNavigate}");
    expect(chip).not.toContain("setOpen(false)");
  });

  it("only closes on the mobile breakpoint", () => {
    const fn = SRC.slice(SRC.indexOf("function handleNavigate()"), SRC.indexOf("async function ask"));
    expect(fn).toContain('matchMedia("(min-width: 768px)")');
    expect(fn).toContain("setOpen(false)");
  });

  it("the explicit close button still closes unconditionally", () => {
    // Regression guard the other way: handleNavigate must not have been wired
    // to the header X, which should always close.
    expect(SRC).toContain('aria-label="Close help"');
    expect(SRC).toMatch(/aria-label="Close help"[\s\S]{0,120}setOpen\(false\)|onClick=\{\(\) => setOpen\(false\)\}[\s\S]{0,120}aria-label="Close help"/);
  });
});
