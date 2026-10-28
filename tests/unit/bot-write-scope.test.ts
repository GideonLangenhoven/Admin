import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Tenant rule: every bot write names the tenant, even when the row id came from the server.
const unscoped = (file: string) => {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/\.from\("(\w+)"\)\s*\.(update|delete|upsert)\(/g)]
    .filter(m => !src.slice(m.index).split(";")[0].includes("business_id"))
    .map(m => m[1] + "." + m[2] + "@" + src.slice(0, m.index).split("\n").length);
};

describe("bot writes are tenant-scoped", () => {
  it("web chat", () => expect(unscoped("supabase/functions/web-chat/index.ts")).toEqual([]));
  it("WhatsApp (setConvo's id comes from the tenant-scoped getConvo)", () => {
    expect(unscoped("supabase/functions/wa-webhook/index.ts").map(hit => hit.split("@")[0])).toEqual(["conversations.update"]);
  });
});
