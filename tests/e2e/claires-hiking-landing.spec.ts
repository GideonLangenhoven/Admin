import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const path = process.env.CLAIRES_HIKING_URL ? '/' : '/demo/claires-hiking/index.html';
const bookingOrigin = 'https://kayak.booking.bookingtours.co.za';
const morningTour = '96e07644-315b-4e96-8f36-bb070b665cf8';

test('loads the requested Kayak embed and carries a live departure into booking', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(page).toHaveTitle(/Kayak Cape Town/);
  await expect(page.getByRole('link', { name: 'Kayak Cape Town home' })).toBeVisible();
  const iframe = page.locator('.hero #bookingtours-widget[data-tenant="kayak"] iframe');
  await expect(iframe).toHaveAttribute('src', `${bookingOrigin}/embed?source=widget`);
  await expect(iframe).toHaveAttribute('title', 'Book your tour');
  const widget = page.frameLocator('#bookingtours-widget iframe');
  await expect(widget.getByRole('button', { name: /Experience Choose an experience/ })).toBeVisible({ timeout: 30000 });
  await expect(widget.getByRole('listbox')).toHaveCount(0);
  await widget.getByRole('button', { name: 'Open experience list' }).click();
  await expect(widget.getByRole('option', { name: /Morning Kayak/ })).toBeVisible({ timeout: 30000 });
  await expect(widget.getByRole('option', { name: /Sunset Paddle/ })).toBeVisible();
  await widget.getByRole('option', { name: /Morning Kayak/ }).click();
  const departure = widget.getByRole('link', { name: /^Book Morning Kayak on/ }).first();
  await expect(departure).toBeVisible({ timeout: 20000 });
  const link = new URL((await departure.getAttribute('href'))!);
  expect(link.origin).toBe(bookingOrigin);
  expect(link.pathname).toBe('/book');
  expect(link.searchParams.get('tour')).toBe(morningTour);
  expect(link.searchParams.get('slot')).toMatch(/^[a-f0-9-]{36}$/);
  expect(link.searchParams.get('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(link.searchParams.get('source')).toBe('widget');
  const departureTime = (await departure.getAttribute('aria-label'))!.match(/at (\d{2}:\d{2})/)![1];
  const [checkout] = await Promise.all([page.waitForEvent('popup'), departure.click()]);
  await checkout.waitForLoadState('domcontentloaded');
  expect(checkout.url()).toBe(link.href);
  await expect(checkout.getByText(departureTime, { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(checkout.getByText('Selected', { exact: true })).toBeVisible();
  await expect(checkout.getByRole('button', { name: /Continue to Details/i }).first()).toBeEnabled();
  await checkout.close();
  expect(errors).toEqual([]);
});

test('fits the live widget on phones, tablets and desktops and keeps the booking anchor visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${path}#book`);
  const widget = page.frameLocator('#bookingtours-widget iframe');
  await expect(widget.getByRole('button', { name: /Experience Choose an experience/ })).toBeVisible({ timeout: 30000 });
  await widget.getByRole('button', { name: 'Open experience list' }).click();
  await expect(widget.getByRole('option', { name: /Morning Kayak/ })).toBeVisible({ timeout: 30000 });
  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#book').evaluate(element => element.scrollIntoView());
    const bounds = await page.evaluate(() => {
      const booking = document.getElementById('book')!.getBoundingClientRect();
      const header = document.querySelector('.header')!.getBoundingClientRect();
      return { scrollWidth: document.documentElement.scrollWidth, left: booking.left, right: booking.right, top: booking.top, headerBottom: header.bottom };
    });
    expect(bounds.scrollWidth, `page overflow at ${width}px`).toBeLessThanOrEqual(width);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.top).toBeGreaterThanOrEqual(bounds.headerBottom);
    await expect(widget.getByRole('option', { name: /Morning Kayak/ })).toBeVisible();
    expect(await widget.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 520) {
      await expect(page.locator('.mobile-book')).toBeHidden();
      expect((await page.locator('.nav .button').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await widget.getByRole('option', { name: /Morning Kayak/ }).click();
  await expect(widget.getByRole('link', { name: /^Book Morning Kayak on/ }).first()).toBeVisible({ timeout: 20000 });
  await page.setViewportSize({ width: 375, height: 812 });
  const frame = page.frames().find(frame => frame.url().startsWith(`${bookingOrigin}/embed`))!;
  await expect.poll(async () => {
    const contentHeight = await frame.evaluate(() => document.body.scrollHeight);
    const frameHeight = (await page.locator('#bookingtours-widget iframe').boundingBox())!.height;
    return Math.abs(contentHeight - frameHeight);
  }).toBeLessThanOrEqual(2);
});

test('keeps the provider widget prominent in the hero with matching kayaking photography', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  const widget = page.frameLocator('#bookingtours-widget iframe');
  await expect(widget.getByRole('button', { name: /Experience Choose an experience/ })).toBeVisible({ timeout: 30000 });
  await expect(widget.getByRole('listbox')).toHaveCount(0);
  await expect.poll(() => page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  const bounds = await page.evaluate(() => {
    const hero = document.querySelector('.hero')!.getBoundingClientRect();
    const widget = document.getElementById('book')!.getBoundingClientRect();
    return { scroll: scrollY, heroTop: hero.top, heroBottom: hero.bottom, widgetTop: widget.top, widgetBottom: widget.bottom, viewport: innerHeight };
  });
  expect(bounds.scroll).toBe(0);
  expect(bounds.widgetTop).toBeGreaterThanOrEqual(bounds.heroTop);
  expect(bounds.widgetBottom).toBeLessThanOrEqual(bounds.heroBottom);
  expect(bounds.widgetBottom).toBeLessThan(bounds.viewport);
  await page.screenshot({ path: testInfo.outputPath('desktop-hero.png') });
  await page.screenshot({ path: testInfo.outputPath('desktop-page.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => page.locator('#book').evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(720);
  await page.setViewportSize({ width: 1440, height: 900 });
  await widget.getByRole('button', { name: 'Open experience list' }).click();
  await widget.getByRole('option', { name: /Morning Kayak/ }).click();
  await expect(widget.getByRole('link', { name: /^Book Morning Kayak on/ }).first()).toBeVisible({ timeout: 20000 });
  await page.locator('#book').screenshot({ path: testInfo.outputPath('desktop-departures.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('#book').evaluate(element => element.scrollIntoView());
  await page.locator('#book').screenshot({ path: testInfo.outputPath('mobile-widget.png') });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: testInfo.outputPath('mobile-page.png'), fullPage: true });
});

test('keeps direct booking available if the embed cannot load and supports keyboard navigation', async ({ page }) => {
  await page.route('https://booking.bookingtours.co.za/widget.js', route => route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${path}#book`);
  const calendar = page.getByRole('link', { name: 'Open full booking calendar', exact: true });
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAttribute('href', `${bookingOrigin}/book`);
  await calendar.focus();
  await expect(calendar).toBeFocused();
  await page.locator('summary').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
  expect(await page.locator('html').evaluate(element => getComputedStyle(element).scrollBehavior)).toBe('auto');
  for (const link of await page.locator('a[href*="booking.bookingtours.co.za"]').evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href))) {
    expect(new URL(link).origin).toBe(bookingOrigin);
  }
});

test('the production alias serves the exact updated page and all matching photos', async ({ request }) => {
  test.skip(!process.env.CLAIRES_HIKING_URL, 'Verify the public alias after deployment.');
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe(readFileSync('public/demo/claires-hiking/index.html', 'utf8'));
  for (const name of ['kayak-cape-town.webp', 'kayak-morning.webp', 'kayak-sunset.webp']) {
    const image = await request.get(`/demo/claires-hiking/assets/${name}`);
    expect(image.status()).toBe(200);
    expect(await image.body()).toEqual(readFileSync(`public/demo/claires-hiking/assets/${name}`));
  }
});
