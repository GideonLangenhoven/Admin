import { describe, expect, it } from "vitest";
import { parseActions } from "../../components/helpChatActions";

// The help assistant drives the dashboard via [[open]]/[[fill]]/[[submit]]
// directives at the end of its reply. If this parser breaks, the assistant
// either leaks directive syntax into the chat or silently stops acting.
describe("help assistant action directives", () => {
  it("splits open, fills and submit off the prose", () => {
    const r = parseActions(
      "Open [Vouchers](/vouchers) and I'll fill it in.\n[[open:/vouchers]]\n[[fill:buyer_email=jo@x.co]]\n[[fill:voucher_value=650]]\n[[submit]]",
    );
    expect(r.open).toBe("/vouchers");
    expect(r.fills).toEqual([
      ["buyer_email", "jo@x.co"],
      ["voucher_value", "650"],
    ]);
    expect(r.submit).toBe(true);
    expect(r.text).toBe("Open [Vouchers](/vouchers) and I'll fill it in.");
  });

  it("passes plain answers through untouched", () => {
    expect(parseActions("Plain answer, no actions.")).toEqual({
      text: "Plain answer, no actions.",
      open: null,
      fills: [],
      submit: false,
    });
  });

  it("keeps query params in open and defaults submit to false", () => {
    const r = parseActions("[[open:/slots?panel=add]]\n[[fill:slot_time=09:00]]");
    expect(r.open).toBe("/slots?panel=add");
    expect(r.fills).toEqual([["slot_time", "09:00"]]);
    expect(r.submit).toBe(false);
    expect(r.text).toBe("");
  });

  it("only splits a fill on the first equals sign", () => {
    const r = parseActions("[[fill:gift_message=Happy b-day = enjoy!]]");
    expect(r.fills).toEqual([["gift_message", "Happy b-day = enjoy!"]]);
  });
});
