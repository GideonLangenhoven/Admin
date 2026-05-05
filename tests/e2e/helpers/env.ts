import { expect } from "@playwright/test";

export constBASE_URL = process.env.BASE_URL || "https://aonyx.booking.bookingtours.co.za";
export constADMIN_URL = process.env.ADMIN_URL || "https://aonyx.admin.bookingtours.co.za";
export constADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
export constADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
export constTEST_CARD = "4242424242424242";
export constTEST_CUSTOMER = {
  name: "Playwright Test",
  email: "gidslang89@gmail.com",
  phone: "0821234567",
};

export function requireAdminCreds() {
  expect(ADMIN_EMAIL, "ADMIN_EMAIL env var required").not.toBe("");
  expect(ADMIN_PASSWORD, "ADMIN_PASSWORD env var required").not.toBe("");
}
