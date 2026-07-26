import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Wildcard DNS serves every *.admin.bookingtours.co.za host and the admin app
// resolves the tenant from the session, so any subdomain "works". Host wins:
// the URL names the operator whose console you are on, and a session for a
// different operator gets a choice instead of being redirected away.
describe("admin canonical-host handling", () => {
  const gate = readFileSync("components/AuthGate.tsx", "utf8");

  it("loads the business subdomain alongside the context fields", () => {
    expect(gate).toMatch(/select\("[^"]*subdomain[^"]*"\)/);
  });

  it("flags a host whose tenant label mismatches the session's business", () => {
    expect(gate).toContain("\\.admin\\.bookingtours\\.co\\.za$");
    expect(gate).toContain("hostMatch[1] !== canonicalSub");
    expect(gate).toContain("{ hostSub: hostMatch[1], ownSub: canonicalSub }");
  });

  it("super admins are exempt (they roam across operators)", () => {
    expect(gate).toContain("!isMultiOperator && canonicalSub");
  });

  // Two hosts each holding a session for the other's tenant used to redirect at
  // each other forever, and a bounce landed on an origin with no session at all.
  it("never moves the browser between tenant hosts on its own", () => {
    expect(gate).not.toContain("window.location.replace");
    expect(gate).not.toContain("window.location.assign");
  });

  it("offers the operator both ways out of a mismatched host", () => {
    expect(gate).toContain("This console belongs to another operator");
    expect(gate).toContain("Go to my console");
    expect(gate).toContain("Sign out and use this one instead");
  });
});
