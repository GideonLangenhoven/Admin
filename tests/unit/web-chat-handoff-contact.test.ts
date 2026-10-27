import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { webChatFixture } from "../helpers/web-chat-fixture";

// M6: the human-handoff reply names the operator's saved contact details,
// never a booking-site section that may not exist.
const handoff = "I've sent this conversation to the team. You can leave more details here; they will reply when available.";

describe("web chat handoff contact details", () => {
  for (const message of ["btn:human", "I want to speak to a human"]) {
    it(`names the saved contact details for ${message}`, async () => {
      const f = webChatFixture();
      Object.assign(f.business, { public_email: "hello@fixture.invalid", public_phone: "+27 21 555 0100", public_whatsapp: "+27 82 555 0100" });
      const result = await f.post(await f.session(), message);
      expect(result.reply).toBe(handoff + " For urgent help, call +27 21 555 0100, WhatsApp +27 82 555 0100 or email hello@fixture.invalid.");
    });

    it(`promises no contact details when none are saved for ${message}`, async () => {
      const f = webChatFixture();
      expect((await f.post(await f.session(), message)).reply).toBe(handoff);
    });
  }

  it("loads the contact details with the tenant", () => {
    const tenant = readFileSync("supabase/functions/_shared/tenant.ts", "utf8");
    const config = tenant.slice(tenant.indexOf("export async function getBusinessConfig"), tenant.indexOf("export async function getTenantByBusinessId"));
    for (const column of ["public_email", "public_phone", "public_whatsapp"]) expect(config).toContain(`"${column}"`);
  });
});
