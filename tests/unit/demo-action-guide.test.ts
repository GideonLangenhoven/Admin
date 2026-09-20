import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { DEMO_ACTIONS, DEMO_SETTINGS, bookingDemoAction, getDemoActionExplanation, isDemoPathVisible } from "../../app/lib/demo-guide";
import { sourceFunction } from "../helpers/source-handler";

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? filesIn(join(dir, entry.name)) : entry.name.endsWith(".tsx") ? [join(dir, entry.name)] : []);
}

function actionBindings(file: string) {
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const bindings: { id: string; handler: string; file: string }[] = [];
  function values(node: ts.Node): string[] {
    if (ts.isStringLiteral(node)) return [node.text];
    if (ts.isJsxExpression(node) && node.expression) return values(node.expression);
    if (ts.isConditionalExpression(node)) return [...values(node.whenTrue), ...values(node.whenFalse)];
    return [];
  }
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const handler = attrs.filter(a => /^on(Click|Change|Submit|DragStart|KeyDown)$/.test(a.name.getText(ast)))
        .map(a => a.getText(ast)).join(" ");
      for (const attr of attrs) {
        if (/^data-demo-(action|submit|drag|enter)$/.test(attr.name.getText(ast)) && attr.initializer)
          for (const id of values(attr.initializer)) bindings.push({ id, handler, file });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return bindings;
}

describe("feature-specific demo catalogue", () => {
  it("never guesses an action from a generic label", () => {
    for (const label of ["Save", "Cancel", "Upload", "Remove", "Unknown action"])
      expect(getDemoActionExplanation(label)).toBeNull();
    expect(bookingDemoAction("Cancel")).toBe("booking.cancel");
    expect(bookingDemoAction("View")).toBeUndefined();
    expect(bookingDemoAction("Edit")).toBeUndefined();
  });

  it("distinguishes closing sales, cancelling guests and weather cancellation", () => {
    expect(getDemoActionExplanation("slot.close")?.operator).toContain("without cancelling");
    expect(getDemoActionExplanation("slot.cancel")?.operator).toContain("all its active bookings");
    expect(getDemoActionExplanation("booking.weather")?.result).toContain("unpaid");
    expect(getDemoActionExplanation("booking.cancel")?.operator).toContain("this party only");
  });

  it("does not confuse uploads, payment links or manual refunds", () => {
    expect(getDemoActionExplanation("logo.upload")?.href).toBe("/settings#admins");
    expect(getDemoActionExplanation("photo.upload")?.result).toContain("use Send Photos");
    expect(getDemoActionExplanation("credentials.yoco")?.title).toContain("live Yoco");
    expect(getDemoActionExplanation("credentials.yoco-test")?.title).toContain("sandbox");
    expect(getDemoActionExplanation("partner.link")?.result).toContain("between operators");
    expect(getDemoActionExplanation("refund.manual")?.result).toContain("does not move money");
  });

  it("keeps explanations concise, concrete and linked to visible features", () => {
    for (const [id, feature] of Object.entries({ ...DEMO_ACTIONS, ...DEMO_SETTINGS })) {
      expect(feature.operator.length, id).toBeLessThan(210);
      expect(feature.result.length, id).toBeLessThan(220);
      expect(isDemoPathVisible(feature.href), id).toBe(true);
      expect(feature.operator + feature.result, id).not.toMatch(/Runs “|selected record|may see a new tour|market.leading|unique on the market/i);
    }
    for (const section of ["admins", "tours", "addons", "external", "site", "embed-widget", "email", "operations", "whatsapp-bot", "dashboard-prefs", "autotags", "invoice", "credentials"])
      expect(DEMO_SETTINGS[section]?.href).toBe("/settings#" + section);
  });

  it("has a real explanation for every annotated action, including conditional buttons", () => {
    const bindings = [...filesIn("app"), ...filesIn("components")].flatMap(actionBindings);
    expect(bindings.length).toBeGreaterThan(170);
    for (const binding of bindings)
      expect(getDemoActionExplanation(binding.id), binding.file + " " + binding.id).not.toBeNull();
  });

  it.each([
    ["app/settings/page.tsx", "handleToggleTestMode", "credentials.test-on"],
    ["app/settings/page.tsx", "handleSaveYoco}", "credentials.yoco"],
    ["app/settings/page.tsx", 'setUploadingField("logo")', "logo.upload"],
    ["app/settings/page.tsx", "handleSaveSiteSettings", "site.save"],
    ["app/settings/page.tsx", "handleSaveRefundPolicy", "site.cancellation"],
    ["app/settings/page.tsx", "handleSaveMarketingTestEmail", "admin.test-email"],
    ["app/slots/page.tsx", "closeSlot(selectedSlot)", "slot.close"],
    ["app/slots/page.tsx", "cancelSlotAndRefund(selectedSlot, true)", "slot.weather"],
    ["app/bookings/page.tsx", "onCancelSlot(slot)", "booking.weather"],
    ["app/bookings/[id]/page.tsx", "saveCustomerDetails", "booking.contact"],
    ["app/inbox/page.tsx", "handleKeyDown", "inbox.reply"],
    ["app/partnerships/page.tsx", "generatePaymentLink", "partner.link"],
  ])("binds %s %s to its own explanation", (file, handler, id) => {
    expect(actionBindings(file).filter(b => b.handler.includes(handler)).map(b => b.id)).toContain(id);
  });
});

describe("demo navigation", () => {
  it.each(["/guide", "/customers", "/reviews", "/notifications", "/settings/ota", "/super-admin"])("excludes %s and deep links", path => {
    expect(isDemoPathVisible(path)).toBe(false);
    expect(isDemoPathVisible(path + "/123?tab=details#edit")).toBe(false);
  });
  it("keeps visible features and settings anchor links available", () => {
    for (const path of ["/", "/photos", "/settings#credentials", "/settings/chat-faq", "/marketing/contacts", "/slots?panel=add"])
      expect(isDemoPathVisible(path)).toBe(true);
    expect(isDemoPathVisible("//other.example/settings")).toBe(false);
  });
});

describe("demo action interception", () => {
  function harness() {
    const setExplanation = vi.fn();
    const stop = sourceFunction("components/DemoActionGuide.tsx", "stop", {});
    const explain = sourceFunction("components/DemoActionGuide.tsx", "explain", { stop, setExplanation, getDemoActionExplanation });
    const handleClick = sourceFunction("components/DemoActionGuide.tsx", "handleClick", { explain, stop, isDemoPathVisible });
    const handleSubmit = sourceFunction("components/DemoActionGuide.tsx", "handleSubmit", { explain, stop });
    const event = (target: unknown, submitter: unknown = null) => ({
      target, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      nativeEvent: { submitter, stopImmediatePropagation: vi.fn() },
    });
    return { setExplanation, handleClick, handleSubmit, event };
  }

  it("stops a nested icon click before a real mutation and shows the matching copy", () => {
    const h = harness();
    const control = { dataset: { demoAction: "slot.close" } };
    const e = h.event({ closest: (selector: string) => selector === "[data-demo-action]" ? control : null });
    h.handleClick(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.nativeEvent.stopImmediatePropagation).toHaveBeenCalled();
    expect(h.setExplanation).toHaveBeenCalledWith(getDemoActionExplanation("slot.close"));
  });

  it("explains a submit button even when its required form fields are empty", () => {
    const h = harness();
    const form = { dataset: { demoSubmit: "credentials.yoco" } };
    const button = { type: "submit", form: { closest: () => form } };
    const e = h.event({ closest: (selector: string) => selector === "button" ? button : null });
    h.handleClick(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(h.setExplanation).toHaveBeenCalledWith(getDemoActionExplanation("credentials.yoco"));
  });

  it("blocks implicit Enter submissions and fails closed for uncatalogued forms", () => {
    const h = harness();
    const form = { dataset: { demoSubmit: "voucher.create" }, closest() { return this; }, querySelector: () => null };
    const e = h.event(form);
    h.handleSubmit(e);
    expect(h.setExplanation).toHaveBeenCalledWith(getDemoActionExplanation("voucher.create"));
    const unknown = h.event({ closest: () => null, querySelector: () => null });
    h.handleSubmit(unknown);
    expect(unknown.preventDefault).toHaveBeenCalled();
  });

  it("leaves form Cancel and navigation controls usable without a fake cancellation popup", () => {
    const h = harness();
    const e = h.event({ closest: (selector: string) => selector === "button" ? { type: "button" } : null });
    h.handleClick(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(h.setExplanation).not.toHaveBeenCalled();
  });
});
