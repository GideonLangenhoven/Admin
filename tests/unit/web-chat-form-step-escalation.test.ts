import { describe, expect, it } from "vitest";
import { webChatFixture } from "../helpers/web-chat-fixture";

// Escalation keywords must not hijack an answer typed into a booking or gift form step.
describe("web chat form steps", () => {
  const question = { key: "medical", label: "Any medical conditions or allergies?", type: "text", required: true };

  it("an answer to a booking question is saved, not escalated", async () => {
    const f = webChatFixture();
    Object.assign(f.business, { booking_custom_fields: [question] });
    const answer = "Nut allergy, allergic reaction if exposed";
    const result = await f.post(await f.session(), answer, { ...f.bookingState, step: "ASK_CUSTOM_FIELD", custom_fields: {} });
    expect(result.state.status).not.toBe("HUMAN");
    expect(result.state.custom_fields.medical).toBe(answer);
    expect(result.state.step).toBe("ASK_VOUCHER");
  });

  it("a gift message is saved, not escalated", async () => {
    const f = webChatFixture();
    const result = await f.post(await f.session(), "Congrats on the pregnancy, enjoy the paddle", { step: "GIFT_MESSAGE", gtid: f.tour.id });
    expect(result.state.status).not.toBe("HUMAN");
    expect(result.state).toMatchObject({ step: "GIFT_BUYER_NAME", gmessage: "Congrats on the pregnancy, enjoy the paddle" });
  });

  it("an explicit ask for a person still hands over from a form step", async () => {
    const f = webChatFixture();
    Object.assign(f.business, { booking_custom_fields: [question] });
    const result = await f.post(await f.session(), "Can I speak to a real person please", { ...f.bookingState, step: "ASK_CUSTOM_FIELD", custom_fields: {} });
    expect(result.state.status).toBe("HUMAN");
  });
});
