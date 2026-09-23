import { describe, expect, it } from "vitest";
import { sourceExports } from "../helpers/source-handler";

describe("public reset rate limiting", () => {
  it("does not consume login or token-completion capacity", async () => {
    class NextResponse extends Response {
      static next() { return new NextResponse(null, { status: 200 }); }
      static redirect(url: URL) { return new NextResponse(null, { status: 307, headers: { Location: url.href } }); }
    }
    const proxy = sourceExports("proxy.ts", { "next/server": { NextResponse } }).proxy as (req: Request) => Promise<Response>;
    const request = (path: string, body: object) => Object.assign(new Request("https://admin.example.invalid" + path, {
      method: "POST",
      headers: { "x-forwarded-for": "192.0.2.154" },
      body: JSON.stringify(body),
    }), { nextUrl: new URL("https://admin.example.invalid" + path) });

    for (let i = 0; i < 5; i++) {
      expect((await proxy(request("/api/admin/setup-link", { action: "send", reason: "RESET", email: "staff@example.invalid" }))).status).toBe(200);
    }
    expect((await proxy(request("/api/admin/setup-link", { action: "send", reason: "RESET", email: "staff@example.invalid" }))).status).toBe(429);
    expect((await proxy(request("/api/admin/login", { email: "staff@example.invalid", password: "fixture" }))).status).toBe(200);
    expect((await proxy(request("/api/admin/setup-link", { action: "complete", email: "staff@example.invalid", token: "fixture" }))).status).toBe(200);
  });
});
