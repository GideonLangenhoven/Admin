import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  options: [] as Array<{ ssl: { rejectUnauthorized: boolean; ca?: string } }>,
  connect: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    constructor(options: typeof fixture.options[number]) { fixture.options.push(options); }
    on() {}
    connect() { return fixture.connect(); }
  },
}));

beforeEach(() => {
  vi.resetModules();
  fixture.options.length = 0;
  fixture.connect.mockReset().mockRejectedValue(new Error("SYNTHETIC_CONNECTION_STOP"));
  vi.stubEnv("AGENT_DATABASE_URL", "postgresql://gateway:synthetic@database.fixture.invalid/postgres");
  vi.stubEnv("AGENT_DATABASE_CA", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("agent database certificate verification", () => {
  it.each(["", "-----BEGIN CERTIFICATE-----\nSYNTHETIC\n-----END CERTIFICATE-----",
    "-----BEGIN CERTIFICATE-----\\nSYNTHETIC\\n-----END CERTIFICATE-----"])(
    "keeps certificate and hostname verification with configured CA %j", async ca => {
      vi.stubEnv("AGENT_DATABASE_CA", ca);
      const { withAgentDb } = await import("../../app/lib/agent-db");
      await expect(withAgentDb(async () => true)).rejects.toThrow("SYNTHETIC_CONNECTION_STOP");
      expect(fixture.options).toHaveLength(1);
      expect(fixture.options[0].ssl.rejectUnauthorized).toBe(true);
      expect(fixture.options[0].ssl.ca).toBe(ca ? ca.replace(/\\n/g, "\n") : undefined);
      expect(fixture.options[0].ssl).not.toHaveProperty("checkServerIdentity");
    },
  );

  it.each(["ssl=false", "sslmode=disable", "sslmode=no-verify", "sslmode=require"])(
    "rejects URL TLS overrides before connecting: %s", async query => {
      vi.stubEnv("AGENT_DATABASE_URL", "postgresql://gateway:synthetic@database.fixture.invalid/postgres?" + query);
      const { withAgentDb } = await import("../../app/lib/agent-db");
      await expect(withAgentDb(async () => true)).rejects.toMatchObject({ code: "INTEGRATION_DISABLED", status: 503 });
      expect(fixture.options).toHaveLength(0);
      expect(fixture.connect).not.toHaveBeenCalled();
    },
  );
});
