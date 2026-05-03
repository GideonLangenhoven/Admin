import { expect } from "@playwright/test";

export var BASE_URL = process.env.BASE_URL || "https://aonyx.booking.bookingtours.co.za";
export var ADMIN_URL = process.env.ADMIN_URL || "https://aonyx.admin.bookingtours.co.za";
export var ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
export var ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
export var TEST_CARD = "4242424242424242";
export var TEST_CUSTOMER = {
  name: "Playwright Test",
  email: "gidslang89@gmail.com",
  phone: "0821234567",
};

export function requireAdminCreds() {
  expect(ADMIN_EMAIL, "ADMIN_EMAIL env var required").not.toBe("");
  expect(ADMIN_PASSWORD, "ADMIN_PASSWORD env var required").not.toBe("");
}
