import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { businessId, fixtureNow, otherTourId, slots, tourId } from "../helpers/booking-guest-fixture.cjs";

const backend = "http://127.0.0.1:35237";
const allergyKey = "any_allergies_87180";
const liveQuestion = { key: allergyKey, label: "Any  Allergies", type: "text", required: true };
const questionInput = (page: Page, key = allergyKey, participant: number | null = null) => page.locator(`#book-question-${key}-${participant === null ? "booking" : participant}`);
const payButton = (page: Page) => page.getByRole("button", { name: /Pay R\d+ now/ }).filter({ visible: true });
const state = async (request: APIRequestContext) => (await request.get(`${backend}/__fixture/state`)).json();
async function details(page: Page, tour = tourId, qty = 1) {
  await page.goto(`/book?tour=${tour}`);
  await expect(page.locator("[data-selected-tour]")).toBeVisible();
  for (let i = 1; i < qty; i++) await page.getByRole("button", { name: "Add one guest" }).click();
  await page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true }).click();
  await expect(page.locator("#booking-step-heading")).toBeFocused();
}
async function contacts(page: Page) {
  await page.locator("#book-name").fill("Authorised Fixture Guest");
  await page.locator("#book-email").fill("guest@example.invalid");
  await page.locator("#book-phone").fill("000000001");
  await page.locator("#book-terms").check();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
}
async function answerUncovered(input: ReturnType<typeof questionInput>) {
  await expect.poll(() => input.evaluate(field => {
    const box = field.getBoundingClientRect();
    const visible = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(15, box.height / 2));
    return visible === field || !!visible && field.contains(visible);
  }), { message: "The focused answer must be clear of sticky navigation" }).toBe(true);
}
async function operatorSession(page: Page) {
  const user = { id: "50000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "operator@example.invalid", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: fixtureNow };
  const exp = Math.floor(Date.parse(fixtureNow) / 1000) + 86400;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ aud: "authenticated", sub: user.id, role: "authenticated", exp })}.mock-signature`, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user };
  await page.context().addCookies([{ name: "ck_session_hint", value: "1", url: "http://127.0.0.1:35238" }, { name: "ck_admin_role", value: "MAIN_ADMIN", url: "http://127.0.0.1:35238" }]);
  await page.addInitScript(({ session, businessId }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_time", String(Date.now()));
    localStorage.setItem("ck_admin_auth", "true");
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_business_id", businessId);
    localStorage.setItem("ck_admin_settings_perms", "{}");
    localStorage.setItem("ck_welcome_done", "1");
  }, { session, businessId });
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${backend}/__fixture/reset`, { data: {} });
  await page.clock.install({ time: new Date(fixtureNow) });
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.addInitScript(() => localStorage.setItem("cookie-consent-accepted", "true"));
  await page.routeWebSocket(/supabase|realtime/i, () => {});
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Other actions disabled in the question fixture" } });
    if (url.pathname === "/fixture-payment") return route.fulfill({ contentType: "text/html", body: "<h1>Sandbox checkout fixture</h1>" });
    return route.continue();
  });
});

test("required live-config question blocks blank payment with a labelled, focused field error", async ({ page, request }, info) => {
  await details(page);
  await contacts(page);
  const question = questionInput(page);
  await expect(question).toBeVisible();
  await expect(question).toHaveAccessibleName(/Any\s+Allergies.*Required/);
  await payButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(question).toBeFocused();
  await answerUncovered(question);
  await expect(question).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(`#${await question.getAttribute("aria-describedby")}`)).toContainText("Please answer");
  expect((await state(request)).bookings).toHaveLength(0);
  expect((await state(request)).providerCalls).toBe(0);
  await noOverflow(page);
  await page.screenshot({ path: `/private/tmp/capekayak-custom-questions-required-${info.project.name}.png`, fullPage: true });
  await question.fill("No allergies (sandbox fixture)");
  await payButton(page).click();
  await expect(page).toHaveURL(/fixture-payment/);
  const result = await state(request);
  expect(result.bookings).toHaveLength(1);
  expect(result.bookings[0]).toMatchObject({ tour_id: tourId, slot_id: slots[0].id, qty: 1, unit_price: 625, total_amount: 625, custom_fields: { [allergyKey]: "No allergies (sandbox fixture)", __booking_questions: { definitions: [{ key: allergyKey, label: liveQuestion.label, required: true }] } } });
  expect(JSON.stringify(result.paymentRequests)).not.toContain("No allergies");
  expect(result.paymentRequests[0].mode).toBe("test");
});

test("optional, disabled and non-applicable questions preserve their configuration", async ({ page, request }) => {
  const questions = [{ key: "optional", label: "Optional note", type: "textarea", required: false }, { key: "off", label: "Disabled question", enabled: false, required: true }, { key: "other", label: "Different tour", tour_ids: [otherTourId], required: true }];
  await request.post(`${backend}/__fixture/reset`, { data: { theme: { booking_custom_fields: questions } } });
  await details(page);
  await contacts(page);
  await expect(questionInput(page, "optional")).toHaveAccessibleName("Optional note (Optional)");
  await expect(page.getByText("Disabled question")).toHaveCount(0);
  await expect(page.getByText("Different tour")).toHaveCount(0);
  await payButton(page).click();
  await expect(page).toHaveURL(/fixture-payment/);
  const fields = (await state(request)).bookings[0].custom_fields;
  expect(fields.optional).toBe("");
  expect(fields).not.toHaveProperty("off");
  expect(fields).not.toHaveProperty("other");
});

test("supported types, choices and each participant retain answers through Back and a held payment retry", async ({ page, request }) => {
  const questions = [liveQuestion, { key: "size", label: "Equipment size", type: "select", scope: "per_participant", required: true, options: [{ value: "s", label: "Small" }, { value: "l", label: "Large" }] }, { key: "age", label: "Age", type: "number", scope: "per_participant", required: true }, { key: "experience", label: "Experience", type: "radio", required: true, options: ["First time", "Experienced"] }, { key: "interests", label: "Interests", type: "multiselect", scope: "per_participant", required: true, options: ["Coast", "Wildlife"] }, { key: "yesno", label: "Equipment needed", type: "checkbox", required: true }, { key: "date", label: "Preferred date", type: "date", required: false }, { key: "note", label: "Extra note", type: "textarea", required: false }];
  await request.post(`${backend}/__fixture/reset`, { data: { theme: { booking_custom_fields: questions }, providerErrorOnce: true } });
  await details(page, tourId, 2);
  await contacts(page);
  await questionInput(page).fill("No allergies (fixture)");
  await questionInput(page, "size", 0).selectOption("s");
  await questionInput(page, "age", 0).fill("0");
  await questionInput(page, "age", 1).fill("18");
  await page.getByRole("radio", { name: "First time", exact: true }).check();
  await page.getByRole("group", { name: /Guest 1: Interests/ }).getByRole("checkbox", { name: "Coast" }).check();
  await page.getByRole("group", { name: /Guest 2: Interests/ }).getByRole("checkbox", { name: "Wildlife" }).check();
  await questionInput(page, "yesno").selectOption("false");
  await questionInput(page, "date").fill("2026-10-03");
  await payButton(page).click();
  await expect(questionInput(page, "size", 1)).toBeFocused();
  expect((await state(request)).prepareCalls).toBe(0);
  await questionInput(page, "size", 1).selectOption("l");
  await page.getByRole("button", { name: "Back to calendar" }).click();
  await page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true }).click();
  await expect(questionInput(page, "size", 0)).toHaveValue("s");
  await expect(questionInput(page, "size", 1)).toHaveValue("l");
  await expect(questionInput(page, "age", 0)).toHaveValue("0");
  await payButton(page).click();
  await expect(page.getByText("Sandbox payment unavailable. Please retry.")).toBeVisible();
  await expect(questionInput(page)).toHaveValue("No allergies (fixture)");
  await questionInput(page).fill("Corrected answer (sandbox fixture)");
  await payButton(page).click();
  await expect(page).toHaveURL(/fixture-payment/);
  const result = await state(request);
  expect(result.bookings).toHaveLength(1);
  expect(result.bookings[0].custom_fields).toMatchObject({ [allergyKey]: "Corrected answer (sandbox fixture)", size: ["s", "l"], age: ["0", "18"], interests: [["Coast"], ["Wildlife"]], experience: "First time", yesno: "false", note: "", date: "2026-10-03" });
  expect(result.providerCalls).toBe(2);
  expect(result.slots[0].held).toBe(slots[0].held + 2);
});

test("configuration read failures block payment and recover without losing entered details", async ({ page, request }) => {
  await request.post(`${backend}/__fixture/reset`, { data: { configError: true } });
  await details(page);
  await contacts(page);
  await expect(page.getByText("We couldn't load the booking questions. Retry to continue to payment.")).toBeVisible();
  await expect(payButton(page)).toBeDisabled();
  expect((await state(request)).bookings).toHaveLength(0);
  await request.post(`${backend}/__fixture/update`, { data: { configError: false } });
  await page.getByRole("button", { name: "Retry booking questions" }).click();
  await expect(questionInput(page)).toBeVisible();
  await expect(page.locator("#book-name")).toHaveValue("Authorised Fixture Guest");
  await questionInput(page).fill("No allergies (fixture)");
  await payButton(page).click();
  await expect(page).toHaveURL(/fixture-payment/);
});

test("server configuration failures never bypass questions and recover on the same booking", async ({ page, request }) => {
  await details(page);
  await contacts(page);
  await questionInput(page).fill("Retained fixture answer");
  await request.post(`${backend}/__fixture/update`, { data: { configError: true } });
  await payButton(page).click();
  await expect(page.getByRole("button", { name: "Retry booking questions" })).toBeVisible();
  expect((await state(request)).prepareCalls).toBe(0);
  await request.post(`${backend}/__fixture/update`, { data: { configError: false } });
  await page.getByRole("button", { name: "Retry booking questions" }).click();
  await expect(questionInput(page)).toHaveValue("Retained fixture answer");
  await payButton(page).click();
  await expect(page).toHaveURL(/fixture-payment/);
  expect((await state(request)).bookings).toHaveLength(1);
});

test("tour changes retain only matching question versions and explicitly remove non-applicable answers", async ({ page, request }) => {
  const questions = [liveQuestion, { key: "pickup", label: "Pickup point", tour_id: tourId, required: true }, { key: "equipment", label: "Equipment", tour_id: otherTourId, required: true }];
  await request.post(`${backend}/__fixture/reset`, { data: { theme: { booking_custom_fields: questions } } });
  await details(page);
  await questionInput(page).fill("Shared fixture answer");
  await questionInput(page, "pickup").fill("Tour A fixture pickup");
  await page.evaluate(id => history.pushState(null, "", `/book?tour=${id}`), otherTourId);
  await expect(page.locator("[data-selected-tour]")).toContainText("Forest trail");
  await page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true }).click();
  await expect(questionInput(page)).toHaveValue("Shared fixture answer");
  await expect(questionInput(page, "pickup")).toHaveCount(0);
  await expect(questionInput(page, "equipment")).toHaveValue("");
  await expect(page.getByText(/Booking questions changed/)).toBeVisible();
  await contacts(page);
  await questionInput(page, "equipment").fill("Tour B fixture equipment");
  await payButton(page).click();
  await expect(page).toHaveURL(/fixture-payment/);
  const booking = (await state(request)).bookings[0];
  expect(booking.tour_id).toBe(otherTourId);
  expect(booking.custom_fields).not.toHaveProperty("pickup");
  expect(booking.custom_fields.equipment).toBe("Tour B fixture equipment");
});

test("operator edits during checkout require review instead of relabelling an old answer", async ({ page, request }) => {
  await details(page);
  await contacts(page);
  await questionInput(page).fill("Old fixture answer");
  const before = await state(request);
  await request.post(`${backend}/__fixture/update`, { data: { theme: { ...before.theme, booking_custom_fields: [{ ...liveQuestion, label: "Emergency contact" }] } } });
  await payButton(page).click();
  await expect(questionInput(page)).toHaveAccessibleName(/Emergency contact/);
  await expect(questionInput(page)).toHaveValue("");
  await expect(page.getByText(/Booking questions changed/)).toBeVisible();
  expect((await state(request)).prepareCalls).toBe(0);
  await questionInput(page).fill("New fixture answer");
  await payButton(page).click();
  await expect(page).toHaveURL(/fixture-payment/);
  expect((await state(request)).bookings).toHaveLength(1);
});

test("saved answers appear on the matching operator details and authorised guide manifest with historical labels", async ({ page, request }) => {
  await details(page);
  await contacts(page);
  await questionInput(page).fill("Historical answer (sandbox fixture)");
  expect(await page.evaluate(() => Object.keys(localStorage).map(key => localStorage.getItem(key)).join("\n"))).not.toContain("Historical answer");
  await payButton(page).click();
  await expect(page).toHaveURL(/fixture-payment/);
  const result = await state(request);
  const booking = result.bookings[0];
  await request.post(`${backend}/__fixture/confirm`, { data: { booking_id: booking.id } });
  await request.post(`${backend}/__fixture/update`, { data: { theme: { ...result.theme, booking_custom_fields: [{ ...liveQuestion, label: "Changed after booking" }] } } });
  await operatorSession(page);
  await page.goto(`http://127.0.0.1:35238/bookings/${booking.id}`);
  await expect(page.getByText("Historical answer (sandbox fixture)", { exact: true })).toBeVisible();
  await expect(page.getByText(/Any\s+Allergies/, { exact: true })).toBeVisible();
  await expect(page.getByText("Changed after booking", { exact: true })).toHaveCount(0);
  await page.goto(`http://127.0.0.1:35238/guide/slot/${booking.slot_id}`);
  await expect(page.getByText("Historical answer (sandbox fixture)", { exact: true })).toBeVisible();
  await expect(page.getByText(/Any\s+Allergies/, { exact: true })).toBeVisible();
  await noOverflow(page);
  const anonymous = await request.get(`${backend}/rest/v1/bookings?select=custom_fields&id=eq.${booking.id}`, { headers: { apikey: "fixture-only", authorization: "Bearer fixture-only", "x-tenant-business-id": businessId } });
  expect(await anonymous.json()).toEqual([]);
  await page.goto("http://127.0.0.1:35236/");
  await expect(page.getByText("Historical answer (sandbox fixture)", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).map(key => localStorage.getItem(key)).join("\n"))).not.toContain("Historical answer");
});

test("long multilingual labels and field hints wrap on small screens with keyboard-accessible errors", async ({ page, request }, info) => {
  const label = "Booking needs: " + "longquestionword".repeat(20) + " café 测试";
  await request.post(`${backend}/__fixture/reset`, { data: { theme: { booking_custom_fields: [{ key: "needs", label, type: "textarea", required: true, placeholder: "Describe your needs (sandbox fixture only)." }] } } });
  await page.setViewportSize({ width: 320, height: 844 });
  await details(page);
  await contacts(page);
  const input = questionInput(page, "needs");
  await expect(input).toHaveAccessibleName(label + " (Required)");
  await payButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  await answerUncovered(input);
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("Test only: café 测试 مرحبا\nSecond line");
  await page.keyboard.press("Tab");
  await expect(input).not.toBeFocused();
  await noOverflow(page);
  await page.screenshot({ path: `/private/tmp/capekayak-custom-questions-long-${info.project.name}.png`, fullPage: true });
});
