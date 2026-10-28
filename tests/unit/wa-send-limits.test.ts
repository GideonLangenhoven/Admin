import { describe, expect, it } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// Meta rejects interactive messages over its limits, and the guest then gets nothing.
const wa = "supabase/functions/wa-webhook/index.ts";
function senders() {
  const out: any[] = [];
  const sendWA = async (_t: any, _to: any, body: any) => { out.push(body); return {}; };
  const sendText = async (_t: any, _to: any, text: string) => { out.push({ type: "text", text: { body: text } }); };
  const clip = sourceFunction(wa, "clip", {});
  const interactiveBody = sourceFunction(wa, "interactiveBody", { sendText });
  return {
    out, clip,
    sendButtons: sourceFunction(wa, "sendButtons", { sendWA, clip, interactiveBody }),
    sendList: sourceFunction(wa, "sendList", { sendWA, clip, interactiveBody }),
  };
}
const tenant = { business: { id: "tenant-a" } };

describe("WhatsApp interactive limits", () => {
  it("clips on whole characters and marks the cut", () => {
    const { clip } = senders();
    expect(clip("\u{1F6F6} Sunset Paddle Experience", 20)).toBe("\u{1F6F6} Sunset Paddle Ex…");
    expect(clip("\u{1F6F6} Sunset Paddle Experience", 20).length).toBeLessThanOrEqual(20);
    expect(clip("x".repeat(19) + "\u{1F6F6}", 20)).toBe("x".repeat(19) + "…"); // never half an emoji
    expect(clip("Short", 20)).toBe("Short");
  });

  it("buttons: at most three, titles within 20", async () => {
    const { out, sendButtons } = senders();
    await sendButtons(tenant, "27825550100", "Pick one", [1, 2, 3, 4].map(n => ({ id: "B" + n, title: "✅ Pay R1852.50 for the whole group " + n })));
    const buttons = out[0].interactive.action.buttons;
    expect(buttons.map((b: any) => b.reply.id)).toEqual(["B1", "B2", "B3"]);
    for (const b of buttons) expect(b.reply.title.length).toBeLessThanOrEqual(20);
  });

  it("lists: at most ten rows, titles within 24 and descriptions within 72", async () => {
    const { out, sendList } = senders();
    const rows = Array.from({ length: 12 }, (_, n) => ({ id: "TOUR_" + n, title: "Sunset Kayak & Champagne Experience " + n, description: "R650/pp • " + "a long description ".repeat(6) }));
    await sendList(tenant, "27825550100", "Pick a tour", "Choose a Tour", [{ title: "Our Tours", rows }]);
    const sent = out[0].interactive.action.sections[0].rows;
    expect(sent).toHaveLength(10);
    for (const r of sent) { expect(r.title.length).toBeLessThanOrEqual(24); expect(r.description.length).toBeLessThanOrEqual(72); }
  });

  it("a body over 1024 characters goes out as text, with a short prompt on the buttons", async () => {
    const { out, sendButtons } = senders();
    const long = "Here’s what’s available:\n" + "\u{1F6F6} *Sunset Paddle* Wed 28 Oct, 17:00, 6 spots, R450/pp\n".repeat(30);
    await sendButtons(tenant, "27825550100", long, [{ id: "BOOK", title: "Book Now" }]);
    expect(out[0]).toEqual({ type: "text", text: { body: long } });
    expect(out[1].interactive.body.text).toBe("Choose an option:");
  });
});
