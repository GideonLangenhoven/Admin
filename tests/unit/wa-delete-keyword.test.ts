import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The WhatsApp DELETE keyword is the self-service POPIA erasure path published at
// bookingtours.co.za/data-deletion, and Meta reviewers test it during app review.
// It is also irreversible, so the matcher has to be wide enough to catch how people
// actually phrase it and narrow enough never to swallow a booking cancellation.
describe("wa-webhook data-deletion keyword", () => {
  const src = readFileSync("supabase/functions/wa-webhook/index.ts", "utf8");

  const literal = src.match(/const DELETE_RE = (\/.*\/);/)?.[1];
  const DELETE_RE = new RegExp(
    literal!.slice(1, literal!.lastIndexOf("/")),
    literal!.slice(literal!.lastIndexOf("/") + 1),
  );

  // Matches the wa-webhook normalisation: (text || "").trim().toLowerCase()
  const match = (s: string) => DELETE_RE.test(s.trim().toLowerCase());

  it("matches the bare keyword the published instructions tell people to send", () => {
    expect(match("DELETE")).toBe(true);
    expect(match("delete")).toBe(true);
    expect(match(" Delete ")).toBe(true);
    expect(match("delete.")).toBe(true);
  });

  it("matches the phrasings a guest or reviewer actually types", () => {
    for (const s of [
      "delete my data",
      "please delete my data",
      "delete all my data",
      "erase my personal information",
      "remove my details",
      "delete our records",
    ]) {
      expect(match(s), s).toBe(true);
    }
  });

  it("never fires on a booking cancellation", () => {
    for (const s of [
      "delete my booking",
      "can you delete the 3pm slot",
      "please delete my reservation",
      "delete my trip",
      "undelete",
    ]) {
      expect(match(s), s).toBe(false);
    }
  });

  it("stays above the bot-mode gate so it works when the assistant is off", () => {
    expect(src.indexOf("const DELETE_RE")).toBeLessThan(src.indexOf("const botGate ="));
  });
});
