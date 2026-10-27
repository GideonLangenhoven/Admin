import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
const origin = process.env.PHOTO_PREVIEW_ORIGIN || "http://127.0.0.1:3206";
const supabaseHost = process.env.PHOTO_SUPABASE_HOST || "guidefixture.supabase.co";
const biz = "10000000-0000-4000-8000-000000000001", user = "10000000-0000-4000-8000-000000000010", slot = "10000000-0000-4000-8000-000000000040", secondSlot = "10000000-0000-4000-8000-000000000041";
const gallery = "https://drive.google.com/file/d/synthetic/view", button = "Send photos";
async function fixture(page: Page, { owner = false, drive = true, failUpload = false, failEmail = false, unconfirmedUpload = "" } = {}) {
  const calls: { path: string; body: any }[] = [];
  let folder = 0, uploadFailed = false;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const email = owner ? "owner@example.invalid" : "guide+cape-kayak@guides.bookingtours.co.za";
  const auth = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user, role: "authenticated", aud: "authenticated", exp: expires })}.fixture`, refresh_token: "synthetic", expires_in: 3600, expires_at: expires, token_type: "bearer", user: { id: user, email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: new Date().toISOString() } };
  await page.routeWebSocket(/realtime/, () => {});
  await page.addInitScript(({ auth, email, biz, key, owner }) => { const prefix=owner?"":"guide:";localStorage.setItem(owner?key:key.replace("-auth-token","-guide-auth-token"), JSON.stringify(auth)); localStorage.setItem(prefix+"ck_admin_email", email); localStorage.setItem(prefix+"ck_admin_time", String(Date.now())); localStorage.setItem(prefix+"ck_admin_business_id", biz); localStorage.setItem("ck_welcome_done", "1"); }, { auth, email, biz, owner, key: "sb-" + supabaseHost.split(".")[0] + "-auth-token" });
  const trips = [{ id: slot, start_time: new Date(Date.now() - 3600000).toISOString(), booked: 7, tours: { name: "Morning paddle" } }, { id: secondSlot, start_time: new Date(Date.now() - 7200000).toISOString(), booked: 4, tours: { name: "Coastal walk" } }];
  const photos = [{ id: "photo-a", photo_url: gallery, gdrive_view_url: gallery, uploaded_at: new Date().toISOString(), slots: { start_time: trips[0].start_time, tours: { name: "Morning paddle" } } }];
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,OPTIONS" }, body: JSON.stringify(body) });
    if (request.method() === "OPTIONS") return json(null, 204);
    if (url.hostname === "www.googleapis.com" && request.method() === "POST") { calls.push({ path: "google/start", body: request.postDataJSON() }); return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "Location", Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic" } }); }
    if (url.hostname === "www.googleapis.com" && request.method() === "PUT") { calls.push({ path: "google/upload", body: null }); if (unconfirmedUpload === "network") return route.abort("failed"); if (unconfirmedUpload === "missing-id") return json({}); if (failUpload && url.searchParams.get("name") === "clip.mp4" && !uploadFailed) { uploadFailed = true; return json({ error: { message: "Google Drive is temporarily unavailable." } }, 503); } return json({ id: "file-a" }); }
    if (url.pathname === "/api/admin/login") return json({ auth_ready: true, admin: { id: owner ? "owner-a" : "guide-a", email, role: owner ? "MAIN_ADMIN" : "GUIDE", business_id: biz, name: "Example", read_only: false } });
    if (url.pathname === "/api/guide/photos") {
      const kind = url.searchParams.get("kind");
      return json(kind === "slots" ? { slots: trips } : kind === "drive" ? { connected: drive, email: "operator@example.invalid" } : { photos, selected_photos: url.searchParams.get("slot_id") === slot ? photos : [] });
    }
    if (url.pathname === "/api/guide/photo-session") {
      const body = request.postDataJSON(); calls.push({ path: url.pathname, body });
      if (body.action === "folder") { folder++; return json({ folder_url: "https://drive.google.com/drive/folders/folder-" + folder, folder_token: "synthetic-" + folder }); }
      return json(body.action === "start" ? { upload_url: "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic&name=" + body.file_name } : { ok: true });
    }
    if (url.pathname === "/api/guide/send-thank-you") { const body = request.postDataJSON(); calls.push({ path: url.pathname, body }); return json({ sent: 1, failures: failEmail ? ["Alex Guest (email)"] : [] }); }
    if (url.pathname.startsWith("/api/")) return json({ error: "Synthetic fixture refuses other APIs" }, 403);
    if (url.origin === origin) return route.continue();
    if (url.hostname !== supabaseHost) {
      if (request.resourceType() === "image") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#c8dbb3"/></svg>' });
      return route.abort();
    }
    if (url.pathname.includes("/auth/v1/user")) return json(auth.user);
    if (url.pathname.includes("/auth/v1/token")) return json(auth);
    if (url.pathname.endsWith("/functions/v1/google-drive")) { const body = request.postDataJSON(); calls.push({path:url.pathname,body}); return json(body.action === "status" ? { connected: drive, email: "operator@example.invalid" } : body.action === "token" ? { access_token: "synthetic-google", folder_id: "root-a" } : { folder_id: "folder-a", folder_url: "https://drive.google.com/drive/folders/folder-a" }); }
    if (url.pathname.endsWith("/functions/v1/send-email") || url.pathname.endsWith("/functions/v1/send-whatsapp-text")) { calls.push({ path: url.pathname, body: request.postDataJSON() }); return json({ ok: true }); }
    if (url.pathname.endsWith("/admin_users")) return json(owner ? [{ id: "owner-a", user_id: user, email, business_id: biz, role: "MAIN_ADMIN", name: "Owner", suspended: false, read_only: false }] : []);
    if (url.pathname.endsWith("/businesses")) return json([{ id: biz, name: "Example Tours", business_name: "Example Tours", timezone: "Africa/Johannesburg", subscription_status: "ACTIVE", subdomain: "cape-kayak", currency: "ZAR" }]);
    if (url.pathname.endsWith("/rpc/guide_context")) return json({ id: biz, name: "Example Tours", business_name: "Example Tours", timezone: "Africa/Johannesburg", subscription_status: "ACTIVE", subdomain: "cape-kayak" });
    if (url.pathname.endsWith("/guide_accounts")) return json([{ id: "guide-a", business_id: biz, login_name: "guide@cape-kayak" }]);
    if (url.pathname.endsWith("/slots")) return json(trips);
    if (url.pathname.endsWith("/trip_photos")) { if (request.method() === "POST") { calls.push({ path: "save/photos", body: request.postDataJSON() }); return json(null, 201); } return json(url.searchParams.has("slot_id") ? url.searchParams.get("slot_id") === "eq." + slot ? photos : [] : photos); }
    if (url.pathname.endsWith("/bookings")) return json([{ id: "booking-a", customer_name: "Alex Guest", phone: "27820000000", email: "alex@example.invalid", status: "PAID" }]);
    return json([]);
  });
  return calls;
}

test("guide gets the full Photos workspace and sends photos with the thank-you email", async ({ page }) => {
  const calls = await fixture(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/simpleguide/photos/" + slot);
  await expect(page.getByRole("heading", { name: "Trip Photos", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Select Trip (Last 7 Days)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent Photo Links" })).toBeVisible();
  await expect(page.getByRole("button", { name: button, exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Full dashboard" })).toHaveCount(0);
  mkdirSync(".vercel/guide-photos", { recursive: true }); await page.screenshot({ path: ".vercel/guide-photos/guide-phone-start.png", fullPage: true, animations: "disabled" });
  await page.locator('input[type=file]').setInputFiles([{ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("synthetic") }, { name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("synthetic") }]);
  await page.getByRole("button", { name: "Upload to Google Drive", exact: true }).click();
  await expect(page.getByText("Uploaded photo folder", { exact: true })).toBeVisible();
  expect(calls.filter(call => call.path === "google/upload")).toHaveLength(2);
  await page.getByRole("button", { name: button, exact: true }).click();
  await page.getByRole("button", { name: "Send now", exact: true }).click();
  await expect(page.getByText("Photos sent to 1 lead booker.", { exact: true })).toBeVisible();
  expect(calls.filter(call => call.path.endsWith("/functions/v1/google-drive"))).toHaveLength(0);
  expect(calls.find(call => call.path === "/api/guide/send-thank-you")?.body).toEqual({ slot_id: slot, photo_urls: [gallery, "https://drive.google.com/drive/folders/folder-1"] });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync(".vercel/guide-photos", { recursive: true }); await page.screenshot({ path: ".vercel/guide-photos/guide-phone.png", fullPage: true, animations: "disabled" });
});

test("main Photos uses the requested button and existing WhatsApp and email template", async ({ page }) => {
  const calls = await fixture(page, { owner: true, drive: false }); await page.goto("/photos");
  await page.getByRole("button", { name: /Morning paddle/ }).click();
  await page.getByPlaceholder("Paste one image URL per line").fill("https://photos.example.invalid/one.jpg\nhttps://photos.example.invalid/two.jpg");
  await page.getByRole("button", { name: "Import links", exact: true }).click();
  await page.getByRole("button", { name: button, exact: true }).click();
  await page.getByRole("button", { name: "Send now", exact: true }).click();
  await expect(page.getByText("Photos sent to 1 lead booker.", { exact: true })).toBeVisible();
  const email = calls.find(call => call.path.endsWith("/send-email"))?.body;
  expect(email).toMatchObject({ type: "TRIP_PHOTOS", data: { business_id: biz, photo_urls: ["https://photos.example.invalid/one.jpg", "https://photos.example.invalid/two.jpg"] } });
  expect(calls.filter(call => call.path.endsWith("/send-whatsapp-text"))).toHaveLength(1);
});

test("guide uploads retain failed video files and earlier folders when retrying", async ({ page }) => {
  const calls = await fixture(page, { failUpload: true }); await page.goto("/simpleguide/photos/" + slot);
  await expect(page.getByRole("button", { name: button, exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles([{ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("synthetic") }, { name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("synthetic") }]);
  await page.getByRole("button", { name: "Upload to Google Drive", exact: true }).click();
  await expect(page.getByText("1 of 2 files uploaded. Google Drive is temporarily unavailable. Failed files remain selected for retry.", { exact: true })).toBeVisible();
  await expect(page.getByText("1 file selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Upload to Google Drive", exact: true }).click();
  await expect.poll(() => calls.filter(call => call.path === "google/upload").length).toBe(3);
  await expect(page.getByText("1 of 1 files uploaded.", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("https://drive.google.com/drive/folders/...").nth(1)).toHaveValue("https://drive.google.com/drive/folders/folder-1");
  await expect(page.getByPlaceholder("https://drive.google.com/drive/folders/...").nth(2)).toHaveValue("https://drive.google.com/drive/folders/folder-2");
});

for (const unconfirmedUpload of ["network", "missing-id"]) test(`guide does not register an unconfirmed ${unconfirmedUpload} upload`, async ({ page }) => {
  const calls = await fixture(page, { unconfirmedUpload }); await page.goto("/simpleguide/photos/" + slot);
  await expect(page.getByRole("button", { name: button, exact: true })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("synthetic") });
  await page.getByRole("button", { name: "Upload to Google Drive", exact: true }).click();
  await expect(page.getByText(/0 of 1 files uploaded\..*before retrying\. Failed files remain selected for retry\./)).toBeVisible();
  await expect(page.getByText("1 file selected", { exact: true })).toBeVisible();
  expect(calls.filter(call => call.path === "/api/guide/photo-session" && call.body.action === "complete")).toHaveLength(0);
});

test("guide bulk links and partial email failures stay available for correction", async ({ page }) => {
  const calls = await fixture(page, { drive: false, failEmail: true }); await page.goto("/simpleguide/photos/" + slot);
  await expect(page.getByRole("button", { name: button, exact: true })).toBeEnabled();
  await page.getByPlaceholder("Paste one image URL per line").fill("https://photos.example.invalid/one.jpg,https://photos.example.invalid/two.jpg");
  await page.getByRole("button", { name: "Import links", exact: true }).click();
  await page.getByRole("button", { name: button, exact: true }).click(); await page.getByRole("button", { name: "Send now", exact: true }).click();
  await expect(page.getByText(/Messages failed: Alex Guest \(email\)/)).toBeVisible();
  await expect(page.getByPlaceholder("https://drive.google.com/drive/folders/...").first()).toHaveValue("https://photos.example.invalid/one.jpg");
  expect(calls.filter(call => call.path === "/api/guide/send-thank-you")).toHaveLength(1);
});

test("changing trips cannot reuse the previous trip's photo links", async ({ page }) => {
  await fixture(page, { drive: false }); await page.goto("/simpleguide/photos/" + slot);
  await expect(page.getByRole("button", { name: button, exact: true })).toBeEnabled();
  await page.getByRole("button", { name: /Coastal walk/ }).click();
  await expect(page.getByPlaceholder("https://drive.google.com/drive/folders/...").first()).toHaveValue("");
  await expect(page.getByRole("button", { name: button, exact: true })).toBeDisabled();
});
