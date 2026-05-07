import { expect } from "@playwright/test";

export const BASE_URL = process.env.BASE_URL || "https://aonyx.booking.bookingtours.co.za";
export const ADMIN_URL = process.env.ADMIN_URL || "https://aonyx.admin.bookingtours.co.za";
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
export const TEST_CARD = "4242424242424242";
export const TEST_CUSTOMER = {
  name: "Playwright Test",
  email: "gidslang89@gmail.com",
  phone: "0821234567",
};

export function requireAdminCreds() {
  expect(ADMIN_EMAIL, "ADMIN_EMAIL env var required").not.toBe("");
  expect(ADMIN_PASSWORD, "ADMIN_PASSWORD env var required").not.toBe("");
}
