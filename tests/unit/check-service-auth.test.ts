import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("production email service prebuild guard", () => {
  const run = (env: Record<string, string>) => spawnSync(
    process.execPath,
    ["scripts/check-service-auth.mjs"],
    { encoding: "utf8", env: { PATH: process.env.PATH || "", NODE_ENV: "production", ...env } },
  );

  it("requires server credentials for Netlify and Vercel production builds", () => {
    for (const env of [
      { NETLIFY: "true", CONTEXT: "production" },
      { VERCEL_ENV: "production" },
    ]) {
      const result = run(env);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("missing server configuration");
    }
  });

  it("skips provider authorization on a Netlify deploy preview", () => {
    const result = run({ NETLIFY: "true", CONTEXT: "deploy-preview" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skipped outside production");
  });
});
