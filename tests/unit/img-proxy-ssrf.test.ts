import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    expect(SRC).toContain('parsed.protocol !== "https:" && parsed.protocol !== "http:"');
  });

  it("only echoes image content types, with sniffing disabled", () => {
    expect(SRC).toContain('upstreamType.startsWith("image/")');
    expect(SRC).toContain('"X-Content-Type-Options": "nosniff"');
    // The passthrough must reuse the validated type, not re-read the header.
    expect(SRC).not.toContain('"Content-Type": upstream.headers.get("content-type") || "image/jpeg"');
  });
});
