import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

// Reported live: clicking a link in the help assistant (an "Email Marketing"
// source chip, route /marketing) closed the assistant mid-conversation — it
// read as the bot quitting on you. Both the inline answer links and the source
// chips called setOpen(false) unconditionally.
const SRC = readFileSync("components/HelpChat.tsx", "utf8");

// M12: it still closed below 1024px, so on a laptop window or tablet the
// answer vanished whenever the assistant opened a page. Navigation now never
// closes it; the browser check is tests/e2e/help-panel-stays-open.spec.ts.
describe("help assistant survives following its own links", () => {
  it("never closes when a link, source chip or directive navigates", () => {
    expect(SRC).not.toContain("handleNavigate");
    expect(SRC).not.toContain("onNavigate");
    const runActions = SRC.slice(SRC.indexOf("async function runActions"), SRC.indexOf("async function ask"));
    expect(runActions).toContain("router.push(openPath)");
    expect(runActions).not.toContain("setOpen(false)");
    const ast = ts.createSourceFile("HelpChat.tsx", SRC, ts.ScriptTarget.Latest, true);
    const links: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "Link") links.push(node.attributes.getText(ast));
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) expect(link).not.toContain("setOpen(false)");
  });

  it("the explicit close button still closes unconditionally", () => {
    // Regression guard the other way: handleNavigate must not have been wired
    // to the header X, which should always close.
    expect(SRC).toContain('aria-label="Close help"');
    expect(SRC).toMatch(/aria-label="Close help"[\s\S]{0,120}setOpen\(false\)|onClick=\{\(\) => setOpen\(false\)\}[\s\S]{0,120}aria-label="Close help"/);
  });
});
