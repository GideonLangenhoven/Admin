import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { sourceExports } from "../helpers/source-handler";

// Security triage 2026-08-05, item 2 of 3 — /api/img SSRF hardening.
//
// The reported finding (a bare endsWith letting evilsupabase.co through) was
// already fixed: the check is `hostname === h || hostname.endsWith("." + h)`.
// The real hole was that the allowlist only vets the URL we are HANDED, then
// fetch followed redirects. Anyone can register their own <ref>.supabase.co
// project — an allowlisted host — and 302 to 169.254.169.254 or any internal
// address, which the proxy would fetch and echo back.
const SRC = readFileSync("booking/app/api/img/route.ts", "utf8");

// The live allowlist predicate, kept in sync with the route.
const ALLOWED_HOSTS = ["supabase.co", "supabase.in", "images.unsplash.com"];
const hostAllowed = (h: string) => ALLOWED_HOSTS.some((x) => h === x || h.endsWith("." + x));

describe("host allowlist rejects lookalike domains", () => {
  it("does not fall for suffix collisions", () => {
    for (const bad of ["evilsupabase.co", "notsupabase.co", "supabase.co.evil.com", "images.unsplash.com.evil.com", "evil.com"]) {
      expect(hostAllowed(bad), bad).toBe(false);
    }
  });

  it("still allows the real hosts and their subdomains", () => {
    for (const good of ["supabase.co", "abc.supabase.co", "supabase.in", "images.unsplash.com"]) {
      expect(hostAllowed(good), good).toBe(true);
    }
  });

  it("credentials in the URL cannot smuggle an internal host past the check", () => {
    // http://supabase.co@169.254.169.254/ — the host is the metadata IP.
    expect(hostAllowed(new URL("http://supabase.co@169.254.169.254/").hostname)).toBe(false);
  });
});

describe("route refuses to become an SSRF or XSS vector", () => {
  it("never follows an upstream redirect", () => {
    expect(SRC).toContain('redirect: "manual"');
  });

  it("rejects non-http(s) protocols before fetching", () => {
    // ftp://supabase.co/x sets hostname, so the host check alone lets it pass.
    expect(new URL("ftp://supabase.co/x").hostname).toBe("supabase.co");
    expect(SRC).toContain('parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password');
  });

  it("only echoes image content types, with sniffing disabled", () => {
    expect(SRC).toContain('ALLOWED_TYPES.test(upstream.headers.get("content-type") || "")');
    expect(SRC).toContain('"X-Content-Type-Options": "nosniff"');
    expect(SRC).toContain('"Content-Type": `image/${format}`');
    expect(SRC).not.toContain('"Content-Type": upstreamType');
    expect(SRC).not.toContain('body = upstream.body');
  });

  it("rejects unsafe URLs and SVG before any image decoding", async () => {
    const fetchUpstream = vi.fn(async () => new Response("<svg onload='alert(1)'></svg>", {
      headers: { "content-type": "image/svg+xml" },
    }));
    const NextResponse = class extends Response {};
    const get = sourceExports("booking/app/api/img/route.ts", { "next/server": { NextResponse } }, {}, fetchUpstream as typeof fetch).GET as (req: unknown) => Promise<Response>;
    for (const url of ["http://images.unsplash.com/a", "https://user@images.unsplash.com/a", "https://images.unsplash.com:444/a", "https://images.unsplash.com.evil.invalid/a"]) {
      expect((await get({ nextUrl: new URL("https://test.invalid/api/img?url=" + encodeURIComponent(url)) })).status).toBeGreaterThanOrEqual(400);
    }
    expect(fetchUpstream).not.toHaveBeenCalled();
    const svg = await get({ nextUrl: new URL("https://test.invalid/api/img?url=" + encodeURIComponent("https://images.unsplash.com/a")) });
    expect(svg.status).toBe(415);
    expect(fetchUpstream).toHaveBeenCalledOnce();
  });

  it("only returns transformed bytes and fails closed when decoding fails", async () => {
    const upstream = new Response("untrusted", { headers: { "content-type": "image/png" } });
    const fetchUpstream = vi.fn(async () => upstream);
    const pipeline = { resize: vi.fn().mockReturnThis(), webp: vi.fn().mockReturnThis(), avif: vi.fn().mockReturnThis(), toBuffer: vi.fn(async () => Buffer.from("transformed")) };
    const sharp = vi.fn(() => pipeline);
    const NextResponse = class extends Response {};
    const get = sourceExports("booking/app/api/img/route.ts", { "next/server": { NextResponse }, sharp: { default: sharp } }, {}, fetchUpstream as typeof fetch).GET as (req: unknown) => Promise<Response>;
    const request = { nextUrl: new URL("https://test.invalid/api/img?url=" + encodeURIComponent("https://images.unsplash.com/a")) };
    const safe = await get(request);
    expect(safe.status).toBe(200);
    expect(safe.headers.get("content-type")).toBe("image/webp");
    expect(safe.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await safe.text()).toBe("transformed");
    pipeline.toBuffer.mockRejectedValueOnce(new Error("decode failed"));
    fetchUpstream.mockResolvedValueOnce(new Response("untrusted", { headers: { "content-type": "image/png" } }));
    const failed = await get(request);
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toBe("untrusted");
  });
});
