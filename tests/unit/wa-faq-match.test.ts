import { describe, expect, it } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// Substring keywords sent canned answers to everyday messages.
const matchFAQ = sourceFunction("supabase/functions/wa-webhook/index.ts", "matchFAQ", {});

describe("WhatsApp FAQ keywords", () => {
  it.each([
    ["Great, thanks!", "food"], ["When does the trip start?", "groups"], ["I sent you a message", "age"],
    ["I left my bag on the boat", "payment"], ["Can I get a coffee there?", "pricing"], ["Is the window seat free?", "weather"],
    ["Can we book separate trips?", "pricing"],
  ])("%s is not a %s question", (text, wrong) => {
    expect(matchFAQ(text)).not.toBe(wrong);
  });

  it.each([
    ["What are your rates?", "pricing"], ["Can kids join?", "age"], ["Is it a hen party friendly trip?", "groups"],
    ["Will it be windy?", "weather"], ["Where do we meet?", "meeting_point"], ["What's your cancellation policy?", "cancellation"],
    ["Do I need to know how to swim?", "safety"], ["Do you take EFT?", "payment"], ["Where do I park?", "parking"],
  ])("%s still reads as %s", (text, key) => {
    expect(matchFAQ(text)).toBe(key);
  });
});
