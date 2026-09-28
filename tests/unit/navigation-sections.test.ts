import { describe, expect, it } from "vitest";
import { isNavItemActive } from "../../components/nav-active";

const hrefs = ["/", "/broadcasts", "/reports", "/marketing", "/ai-usage", "/settings"];

describe("navigation section moves", () => {
  it.each([
    ["/notifications", "/broadcasts"],
    ["/reviews", "/reports"],
    ["/vouchers", "/marketing"],
    ["/settings/chat-faq", "/ai-usage"],
    ["/privacy/data-requests", "/settings"],
  ])("highlights %s under %s", (path, parent) => {
    expect(isNavItemActive(path, parent, hrefs)).toBe(true);
    expect(hrefs.filter((href) => isNavItemActive(path, href, hrefs))).toEqual([parent]);
  });

  it("keeps OTA settings under Settings and the dashboard exact", () => {
    expect(isNavItemActive("/settings/ota", "/settings", hrefs)).toBe(true);
    expect(isNavItemActive("/reports", "/", hrefs)).toBe(false);
  });
});
