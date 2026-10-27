import { describe, expect, it } from "vitest";
import { loadFaqCandidates, findFaqMatch } from "../../supabase/functions/_shared/intent";
import { webChatFixture } from "../helpers/web-chat-fixture";

function faqFixture() {
  const fixture = webChatFixture();
  const add = (id: string, question: string, keywords: string[], answer: string, overrides = {}) => {
    fixture.rows.chat_faq_entries.push({ id, business_id: "a", enabled: true, question_pattern: question, match_keywords: keywords, answer, use_count: 0, ...overrides });
  };
  return { ...fixture, add };
}

describe("operator FAQ matching", () => {
  it("answers an exact configured question even with one keyword or no keywords", async () => {
    const f = faqFixture();
    f.add("packing", "What should I bring?", ["bring"], "Bring a towel.");
    f.add("payment", "What's accepted for payment?", [], "Visa, Mastercard and Amex.");
    expect(await findFaqMatch(f.db, "a", "OTHER", "WHAT should I bring!")).toBe("Bring a towel.");
    expect(await findFaqMatch(f.db, "a", "OTHER", "What’s accepted for payment?")).toBe("Visa, Mastercard and Amex.");
    expect(f.rows.chat_faq_entries.map(entry => entry.use_count)).toEqual([1, 1]);
  });

  it("does not count duplicate keywords as independent evidence", async () => {
    const f = faqFixture();
    f.add("packing", "Packing list", ["bring", "BRING", " bring "], "Bring a towel.");
    expect(await findFaqMatch(f.db, "a", "OTHER", "Can I bring my dog?")).toBeNull();
    expect((await loadFaqCandidates(f.db, "a", "Can I bring my dog?"))[0].score).toBe(1);
  });

  it("does not mistake short fragments for words or match phrases out of order", async () => {
    const f = faqFixture();
    f.add("payment", "Payment methods", ["visa", "credit card"], "Visa and credit cards accepted.");
    expect(await loadFaqCandidates(f.db, "a", "I need advice")).toEqual([]);
    expect(await loadFaqCandidates(f.db, "a", "card credit")).toEqual([]);
    expect((await loadFaqCandidates(f.db, "a", "Can I pay with visa or credit cards?"))[0].score).toBe(2);
  });

  it("does not inflate confidence with plural variants or overlapping phrases", async () => {
    const f = faqFixture();
    f.add("payment", "Payment methods", ["card", "cards", "credit card"], "We accept credit cards.");
    expect((await loadFaqCandidates(f.db, "a", "Do you take credit cards?"))[0].score).toBe(1);
    expect(await findFaqMatch(f.db, "a", "OTHER", "Do you take credit cards?")).toBeNull();
  });

  it("keeps multiple topics for a grounded answer instead of returning only the top FAQ", async () => {
    const f = faqFixture();
    f.add("packing", "Packing list", ["bring", "packing", "towel"], "Bring a towel.");
    f.add("payment", "Payment methods", ["visa", "card"], "Visa cards accepted.");
    const message = "For packing should I bring a towel, and can I pay with a visa card?";
    expect((await loadFaqCandidates(f.db, "a", message)).map(entry => entry.id)).toEqual(["packing", "payment"]);
    expect(await findFaqMatch(f.db, "a", "OTHER", message)).toBeNull();
    expect(f.rows.chat_faq_entries.every(entry => entry.use_count === 0)).toBe(true);
  });

  it("prefers the exact question over another FAQ's broad keywords", async () => {
    const f = faqFixture();
    f.add("packing", "Can I bring food and water?", ["food"], "Please bring water; food stays ashore.");
    f.add("included", "What's included?", ["bring", "food", "water"], "Equipment is included.");
    expect(await findFaqMatch(f.db, "a", "OTHER", "Can I bring food and water?")).toBe("Please bring water; food stays ashore.");
  });

  it("does not choose arbitrarily between contradictory exact answers", async () => {
    const f = faqFixture();
    f.add("one", "What should I bring?", ["bring"], "Bring a towel.");
    f.add("two", "What should I bring?", ["bring"], "No towel needed.");
    expect(await findFaqMatch(f.db, "a", "OTHER", "What should I bring?")).toBeNull();
  });

  it("ignores disabled, empty, and other operators' answers", async () => {
    const f = faqFixture();
    f.add("disabled", "What should I bring?", ["bring"], "Wrong answer", { enabled: false });
    f.add("empty", "What should I bring?", ["bring"], "   ");
    f.add("other", "What should I bring?", ["bring"], "Other operator's answer", { business_id: "b" });
    expect(await loadFaqCandidates(f.db, "a", "What should I bring?")).toEqual([]);
    expect(await findFaqMatch(f.db, "a", "OTHER", "What should I bring?")).toBeNull();
  });
});
