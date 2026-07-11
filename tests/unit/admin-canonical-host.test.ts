import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Wildcard DNS serves every *.admin.bookingtours.co.za host and the admin app
// resolves the tenant from the profile, so a typo'd subdomain still "works".
// AuthGate must bounce non-super admins to their business's real subdomain.
describe("admin canonical-host redirect", () => {
  const gate = readFileSync("components/AuthGate.tsx", "utf8");

  it("loads the business subdomain alongside the context fields", () => {
    expect(gate).toMatch(/select\("[^"]*subdomain[^"]*"\)/);
  });

  it("redirects when the host's tenant label mismatches the business subdomain", () => {
    expect(gate).toContain("\\.admin\\.bookingtours\\.co\\.za$");
    expect(gate).toContain("window.location.replace");
  });

  it("super admins are exempt (they roam across operators)", () => {
    expect(gate).toContain("!isMultiOperator && canonicalSub");
  });
});
