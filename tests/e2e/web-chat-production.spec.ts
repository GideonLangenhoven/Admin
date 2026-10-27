import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:3094";
test.beforeEach(async ({ page, request }) => {
  await request.post(fixtureUrl + "/__fixture/reset");
  // The public production CSP disallows a local fixture origin. Strip it only
  // from this isolated preview's responses, never from deployed application code.
  await page.route("http://127.0.0.1:3093/**", async route => {
    const response = await route.fetch();
    const headers = response.headers();
    delete headers["content-security-policy"];
    await route.fulfill({ response, headers });
  });
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-chat-hydrated", "1");
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
});

async function send(page: any, text: string) {
  await page.getByRole("textbox", { name: "Chat message" }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
}

async function sendResult(page: Page, text: string) {
  const response = page.waitForResponse(response => response.url() === fixtureUrl + "/functions/v1/web-chat" && response.request().postDataJSON().message === text);
  await send(page, text);
  return (await response).json();
}

async function choose(page: Page, name: string | RegExp) {
  await page.getByRole("button", { name, exact: typeof name === "string" }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
}

async function selectionSetup(request: APIRequestContext) {
  return (await request.post(fixtureUrl + "/__fixture/reset", { data: { scenario: "selection", llmAvailable: false } })).json();
}

async function toContacts(page: Page, dates: string[], tour = "Morning Kayak") {
  await send(page, "book");
  await choose(page, new RegExp("^" + tour + ":"));
  const index = tour === "Sunset Paddle" ? 2 : tour === "Midday Hike" ? 3 : 0;
  await choose(page, "Choose " + dates[index]);
  await choose(page, /spots\)$/);
  return sendResult(page, "2 people");
}

for (const departure of ["matching", "missing-day", "missing-time"]) {
  test(`remembers next Wednesday at 06:00 and respects corrections with ${departure} inventory`, async ({ page, request }) => {
    const setup = await (await request.post(fixtureUrl + "/__fixture/reset", { data: { scenario: "wednesday", departure, llmAvailable: false } })).json();
    await send(page, "I want a handburger");
    await send(page, "no please get me a booking for next week Wednesday");
    await expect(page.getByRole("button", { name: "Morning Kayak: R600", exact: true })).toBeVisible();
    for (const message of ["I want to kayak next morning for the 6am slot", "I asked for the Wednesday", "I asked for next Wednesday not Tuesday"]) {
      const response = page.waitForResponse(response => response.url() === fixtureUrl + "/functions/v1/web-chat" && response.request().postDataJSON().message === message);
      await send(page, message);
      const result = await (await response).json();
      const latestReply = page.getByRole("log").locator("p.whitespace-pre-wrap").last();
      await expect(latestReply).toContainText(result.reply);
      expect(result.state.pendingDate).toBe(setup.requestedDate);
      expect(result.state.pendingTime).toBe("06:00");
      if (departure === "matching") {
        expect(result.state).toMatchObject({ step: "ASK_QTY", slotId: "wednesday", selectedDate: setup.requestedDate });
        await expect(latestReply).toContainText("Wednesday");
        await expect(latestReply).toContainText("06:00");
        await expect(latestReply).not.toContainText("Tuesday");
      } else {
        expect(result.state.step).toBe(departure === "missing-day" ? "PICK_DATE" : "PICK_TIME");
        expect(result.state.slotId).toBeFalsy();
        await expect(latestReply).not.toContainText(/how many|great pick/i);
        await expect(latestReply).toContainText("06:00");
        if (departure === "missing-time") await expect(page.getByRole("button", { name: "08:30 (16 spots)", exact: true })).toBeVisible();
        else await expect(page.getByRole("button", { name: /^Choose \d{4}-\d{2}-\d{2}$/ })).toBeVisible();
      }
    }
    if (departure === "missing-time") {
      await page.getByRole("button", { name: "08:30 (16 spots)", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
      await expect(page.getByRole("log").locator("p.whitespace-pre-wrap").last()).toContainText("Wednesday");
      await expect(page.getByRole("log").locator("p.whitespace-pre-wrap").last()).toContainText("08:30");
    }
    const state = await (await request.get(fixtureUrl + "/__fixture/state")).json();
    expect(state.rows.bookings).toHaveLength(0);
    expect(state.calls.filter((call: any) => call.kind === "llm")).toHaveLength(0);
    await page.getByRole("dialog").screenshot({ path: `/private/tmp/capekayak-chat-wednesday-${departure}-${test.info().project.name}.png` });
  });
}

test("first message survives opening the chat", async ({ page }) => {
  await send(page, "What should I bring?");
  await expect(page.getByRole("log")).toContainText("What should I bring?");
  await expect(page.getByRole("log")).toContainText("Bring a towel and water.");
});

test("booking questions preserve the current choice and retire stale buttons", async ({ page, request }) => {
  await send(page, "book");
  const tour = page.getByRole("button", { name: "Sea Kayak Tour: R400", exact: true });
  await tour.click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  await expect(tour).toHaveCount(0);
  await send(page, "Where do we meet?");
  await expect(page.getByRole("log")).toContainText("Back to your booking");
  await send(page, "start over");
  await expect(page.getByRole("log")).toContainText("Let's start fresh");
  const state = await (await request.get(fixtureUrl + "/__fixture/state")).json();
  expect(state.rows.bookings).toHaveLength(0);
});

test("books through the displayed calendar, contact fields, and payment link", async ({ page, request }) => {
  await send(page, "book");
  await page.getByRole("button", { name: "Sea Kayak Tour: R400", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  await send(page, "Where do we meet?");
  await page.getByRole("dialog").screenshot({ path: `/private/tmp/capekayak-webchat-calendar-${test.info().project.name}.png` });
  await page.getByRole("button", { name: /^Choose \d{4}-\d{2}-\d{2}$/ }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  await page.getByRole("button", { name: /10 spots/ }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  for (const message of ["2 adults and 1 child", "Fixture Guest", "guest@fixture.invalid", "+27110000000"]) await send(page, message);
  await page.getByRole("button", { name: /No voucher/ }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  await page.getByRole("button", { name: /Confirm.*Pay R1200/ }).click();
  await expect(page.getByRole("link", { name: "Complete Payment →" })).toHaveAttribute("href", "https://pay.fixture.invalid/checkout-a");
  const state = await (await request.get(fixtureUrl + "/__fixture/state")).json();
  expect(state.rows.bookings).toHaveLength(1);
  expect(state.rows.bookings[0]).toMatchObject({ qty: 3, total_amount: 1200, status: "HELD" });
});

test("human reply arrives once and a new chat resets the server handoff", async ({ page, request }) => {
  await send(page, "I want to speak to a human");
  await expect(page.getByText("Team support", { exact: true })).toBeVisible();
  await request.post(fixtureUrl + "/__fixture/agent", { data: { text: "An operator is here to help." } });
  await expect(page.getByRole("log")).toContainText("An operator is here to help.");
  await expect(page.getByText("An operator is here to help.", { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-chat-hydrated", "1");
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(page.getByText("Team support", { exact: true })).toBeVisible();
  await expect(page.getByText("An operator is here to help.", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  await send(page, "What should I bring?");
  await expect(page.getByRole("log")).toContainText("Bring a towel and water.");
  await expect(page.getByText("Team support", { exact: true })).toHaveCount(0);
});

test("network and expired-session failures leave the chat usable", async ({ page }) => {
  let failed = false;
  await page.route(fixtureUrl + "/functions/v1/web-chat", async route => {
    const body = route.request().postDataJSON();
    if (body.message && !failed) { failed = true; await route.abort("failed"); }
    else await route.continue();
  });
  await send(page, "What should I bring?");
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("We couldn't confirm a reply.");
  await page.getByRole("button", { name: "Retry message", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Bring a towel and water.");
  await expect(page.getByText("What should I bring?", { exact: true })).toHaveCount(1);
  await page.unroute(fixtureUrl + "/functions/v1/web-chat");
  let expired = false;
  await page.route(fixtureUrl + "/functions/v1/web-chat", async route => {
    const body = route.request().postDataJSON();
    if (body.message && !expired) { expired = true; await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "CHAT_SESSION_REQUIRED" }) }); }
    else await route.continue();
  });
  await send(page, "How long is the trip?");
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("We couldn't confirm a reply.");
  await page.getByRole("button", { name: "Retry message", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("log")).toContainText("2 hours");
});

test("a reload preserves booking progress, transcript and the current calendar", async ({ page }) => {
  await send(page, "book");
  await page.getByRole("button", { name: "Sea Kayak Tour: R400", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Choose \d{4}-\d{2}-\d{2}$/ })).toBeEnabled();
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-chat-hydrated", "1");
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  await expect(page.getByRole("log")).toContainText("Sea Kayak Tour: R400");
  await page.getByRole("button", { name: /^Choose \d{4}-\d{2}-\d{2}$/ }).click();
  await expect(page.getByRole("button", { name: /10 spots/ })).toBeVisible();
});

test("a failed choice retries once without displaying an internal button command", async ({ page }) => {
  await send(page, "book");
  let fail = true;
  let sent = 0;
  await page.route(fixtureUrl + "/functions/v1/web-chat", async route => {
    if (route.request().postDataJSON().message === "btn:tour-a") {
      sent++;
      if (fail) { fail = false; await route.abort("failed"); return; }
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Sea Kayak Tour: R400", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry message", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Retry message", exact: true }).evaluate(button => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole("button", { name: /^Choose \d{4}-\d{2}-\d{2}$/ })).toBeEnabled();
  expect(sent).toBe(2);
  await expect(page.getByRole("log")).not.toContainText("btn:tour-a");
  await expect(page.getByText("Sea Kayak Tour: R400", { exact: true })).toHaveCount(1);
});

test("IME confirmation does not submit unfinished multilingual text", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Chat message" });
  await input.fill("こんにちは");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(input).toHaveValue("こんにちは");
  await expect(page.getByRole("log")).not.toContainText("こんにちは");
  await input.press("Enter");
  await expect(page.getByRole("log")).toContainText("こんにちは");
});

test("operator availability remains selectable when the visitor clock is ahead", async ({ page }) => {
  await page.clock.setFixedTime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  await send(page, "book");
  await page.getByRole("button", { name: "Sea Kayak Tour: R400", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Choose \d{4}-\d{2}-\d{2}$/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Next month", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous month", exact: true })).toBeDisabled();
});

test("booking form links are actionable and expired seat holds cannot be paid from chat", async ({ page }) => {
  const expiry = new Date(Date.now() + 60_000).toISOString();
  await page.route(fixtureUrl + "/functions/v1/web-chat", async route => {
    if (!route.request().postDataJSON().message) { await route.continue(); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      reply: "Complete the participant questions in the booking form.", state: { step: "IDLE" },
      bookingUrl: "/book?tour=tour-a&slot=slot-a", paymentUrl: "https://pay.fixture.invalid/checkout-a", paymentExpiresAt: expiry,
    }) });
  });
  await send(page, "book");
  await expect(page.getByRole("link", { name: "Continue booking", exact: true })).toHaveAttribute("href", "/book?tour=tour-a&slot=slot-a");
  await expect(page.getByRole("link", { name: "Complete Payment →" })).toBeVisible();
  await page.clock.setFixedTime(new Date(Date.parse(expiry) + 1));
  await page.getByRole("link", { name: "Complete Payment →" }).click();
  await expect(page.getByRole("link", { name: "Complete Payment →" })).toHaveCount(0);
  await expect(page.getByRole("log")).toContainText("Reservation time has ended.");
  await expect(page.getByRole("link", { name: "View My Bookings", exact: true })).toHaveAttribute("href", "/my-bookings");
});

test("an agent's final message and rating survive a reload while chat is closed", async ({ page, request }) => {
  await send(page, "I want to speak to a human");
  await page.getByRole("button", { name: "Close chat", exact: true }).click();
  await request.post(fixtureUrl + "/__fixture/agent", { data: { text: "Your question is resolved.", end: true } });
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-chat-hydrated", "1");
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(page.getByText("Your question is resolved.", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "5 stars", exact: true })).toBeVisible();
  await expect(page.getByText("Team support", { exact: true })).toHaveCount(0);
});

test("ending human help collects a rating and returns to the bot", async ({ page, request }) => {
  await send(page, "I want to speak to a human");
  await request.post(fixtureUrl + "/__fixture/agent", { data: { text: "All sorted.", end: true } });
  await expect(page.getByRole("button", { name: "5 stars", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "5 stars", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Thanks for your feedback");
  await expect.poll(async () => (await (await request.get(fixtureUrl + "/__fixture/state")).json()).rows.conversations[0].rating).toBe(5);
  await send(page, "What should I bring?");
  await expect(page.getByRole("log")).toContainText("Bring a towel and water.");
});

test("a failed rating can be retried without a false success message", async ({ page, request }) => {
  await send(page, "I want to speak to a human");
  await request.post(fixtureUrl + "/__fixture/agent", { data: { text: "All sorted.", end: true } });
  await expect(page.getByRole("button", { name: "5 stars", exact: true })).toBeVisible();
  let failed = false;
  await page.route(fixtureUrl + "/functions/v1/web-chat", async route => {
    if (route.request().postDataJSON().action === "rate" && !failed) {
      failed = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "5 stars", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Your rating could not be saved.");
  await expect(page.getByRole("log")).not.toContainText("Thanks for your feedback");
  await page.getByRole("button", { name: "5 stars", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Thanks for your feedback");
  await expect.poll(async () => (await (await request.get(fixtureUrl + "/__fixture/state")).json()).rows.conversations[0].rating).toBe(5);
});

test("slow agent polls cannot duplicate replies or revive a restarted chat", async ({ page, request }) => {
  await send(page, "I want to speak to a human");
  let pending = 0;
  let maximum = 0;
  let count = 0;
  let secondStarted!: () => void;
  let secondDelivered!: () => void;
  const started = new Promise<void>(resolve => { secondStarted = resolve; });
  const delivered = new Promise<void>(resolve => { secondDelivered = resolve; });
  await page.route(fixtureUrl + "/functions/v1/web-chat", async route => {
    if (route.request().postDataJSON().action !== "poll") { await route.continue(); return; }
    const index = ++count;
    pending++;
    maximum = Math.max(maximum, pending);
    const response = await route.fetch();
    if (index === 2) secondStarted();
    await new Promise(resolve => setTimeout(resolve, 6500));
    await route.fulfill({ response });
    pending--;
    if (index === 2) secondDelivered();
  });
  await request.post(fixtureUrl + "/__fixture/agent", { data: { text: "The first operator reply." } });
  await expect(page.getByRole("log")).toContainText("The first operator reply.", { timeout: 15_000 });
  await expect(page.getByText("The first operator reply.", { exact: true })).toHaveCount(1);
  expect(maximum).toBe(1);
  await request.post(fixtureUrl + "/__fixture/agent", { data: { text: "A delayed reply from the old thread." } });
  await started;
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Let's start fresh");
  await delivered;
  await expect(page.getByRole("log")).not.toContainText("A delayed reply from the old thread.");
  await expect(page.getByText("Team support", { exact: true })).toHaveCount(0);
});

test("a pending reply finishes before a new chat can clear its transcript", async ({ page, request }) => {
  await request.post(fixtureUrl + "/__fixture/reset", { data: { llmReply: "DELAY" } });
  await page.getByRole("textbox", { name: "Chat message" }).fill("How long does the trip last?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  await expect(page.getByRole("log")).toContainText("Let's start fresh");
  await expect(page.getByRole("log")).not.toContainText("Delayed old reply");
  await expect(page.getByRole("log")).not.toContainText("How long does the trip last?");
});

test("keyboard focus and long replies stay inside the panel", async ({ page, request }) => {
  await request.post(fixtureUrl + "/__fixture/reset", { data: { llmReply: "長い返答🙂 ".repeat(300) } });
  await send(page, "hello");
  const panel = page.getByRole("dialog");
  const dimensions = await panel.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  await page.getByRole("button", { name: "New chat", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(await panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open chat", exact: true })).toBeFocused();
});

test("a failed restart preserves the current choices and can be retried", async ({ page }) => {
  await send(page, "book");
  await page.getByRole("button", { name: "Sea Kayak Tour: R400", exact: true }).click();
  const date = page.getByRole("button", { name: /^Choose \d{4}-\d{2}-\d{2}$/ });
  await expect(date).toBeEnabled();
  let failed = false;
  await page.route(fixtureUrl + "/functions/v1/web-chat", async route => {
    if (route.request().postDataJSON().action === "restart" && !failed) {
      failed = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Your conversation is still here.");
  await expect(date).toBeEnabled();
  await page.getByRole("button", { name: "Retry restart", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Let's start fresh");
  await expect(date).toHaveCount(0);
});

test("every available tour reaches contact collection with its own current price", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  for (const [tour, price] of [["Morning Kayak", 600], ["Sunset Paddle", 500], ["Midday Hike", 750]] as const) {
    await choose(page, "New chat");
    const result = await toContacts(page, dates, tour);
    expect(result.state).toMatchObject({ step: "ASK_DETAILS", tname: tour, tprice: price, qty: 2, total: price * 2 });
    await expect(page.getByRole("log").locator("p.whitespace-pre-wrap").last()).toContainText("one at a time");
    await expect(page.getByRole("log")).not.toContainText("*");
  }
  const fixture = await (await request.get(fixtureUrl + "/__fixture/state")).json();
  expect(fixture.rows.bookings).toHaveLength(0);
  expect(fixture.calls.filter((call: any) => call.kind === "fetch")).toHaveLength(0);
});

test("two tour changes at contact collection preserve contacts and replace every selection in the summary", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  await toContacts(page, dates);
  await send(page, "Zoë O'Neill");
  await send(page, "zoe@fixture.invalid");
  for (const [message, id, tour, index, time, price] of [
    ["Please switch to Sunset Paddle", "sunset", "Sunset Paddle", 2, "17:00", 500],
    ["Can we change the tour to Midday Hike?", "hike", "Midday Hike", 3, "12:00", 750],
  ] as const) {
    const changed = await sendResult(page, message);
    expect(changed.state).toMatchObject({ step: "PICK_DATE", tid: id, tname: tour, name: "Zoë O'Neill", email: "zoe@fixture.invalid", requestedQty: 2 });
    for (const key of ["slotId", "slotTime", "selectedDate", "pendingDate", "pendingTime", "total", "baseTotal", "vid"]) expect(changed.state[key]).toBeFalsy();
    await expect(page.getByRole("log").locator("p.whitespace-pre-wrap").last()).toContainText(tour);
    await choose(page, "Choose " + dates[index]);
    await choose(page, new RegExp("^" + time));
    await choose(page, "Continue with 2 people");
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("bt_chat_transcript:a")!).state);
    expect(stored).toMatchObject({ step: "ASK_DETAILS", tid: id, qty: 2, total: price * 2, name: "Zoë O'Neill", email: "zoe@fixture.invalid" });
  }
  await send(page, "+1 (415) 555-0123");
  const summary = await sendResult(page, "btn:no_voucher");
  expect(summary.state).toMatchObject({ step: "CONFIRM", tid: "hike", slotId: "hike-slot", selectedDate: dates[3], tprice: 750, qty: 2, total: 1500, phone: "+14155550123" });
  const reply = page.getByRole("log").locator("p.whitespace-pre-wrap").last();
  await expect(reply).toContainText("Midday Hike");
  await expect(reply).toContainText("12:00");
  await expect(reply).toContainText("R1500");
  await expect(reply).not.toContainText(/Morning Kayak|Sunset Paddle|08:30|17:00|R1200|R1000/);
  await page.getByRole("dialog").screenshot({ path: `/private/tmp/bookingtours-chat-corrected-summary-${test.info().project.name}.png` });
  expect((await (await request.get(fixtureUrl + "/__fixture/state")).json()).rows.bookings).toHaveLength(0);
});

test("ambiguous and generic tour changes ask for a new tour without consuming contact data", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  await toContacts(page, dates);
  await send(page, "Zoë O'Neill");
  const result = await sendResult(page, "Change to Morning Kayak or Sunset Paddle");
  expect(result.state).toMatchObject({ step: "PICK_TOUR", name: "Zoë O'Neill", requestedQty: 2 });
  expect(result.state.tid).toBeFalsy();
  await expect(page.getByRole("log").locator("p.whitespace-pre-wrap").last()).toContainText("Which tour");
  await choose(page, /^Sunset Paddle:/);
  await choose(page, "Choose " + dates[2]);
  await choose(page, /^17:00/);
  await choose(page, "Continue with 2 people");
  const generic = await sendResult(page, "change tour");
  expect(generic.state.step).toBe("PICK_TOUR");
  expect(generic.state.tid).toBeFalsy();
  expect(generic.state.name).toBe("Zoë O'Neill");
  await expect(page.getByRole("button", { name: /^Midday Hike:/ })).toBeVisible();
  await choose(page, /^Sunset Paddle:/);
  await choose(page, "Choose " + dates[2]);
  await choose(page, /^17:00/);
  await choose(page, "Continue with 2 people");
  const unknown = await sendResult(page, "Switch to Dolphin Cruise");
  expect(unknown.state).toMatchObject({ step: "PICK_TOUR", name: "Zoë O'Neill", requestedQty: 2 });
  expect(unknown.state.tid).toBeFalsy();
  expect(unknown.state.slotId).toBeFalsy();
  expect(unknown.state.total).toBeUndefined();
  await expect(page.getByRole("log").locator("p.whitespace-pre-wrap").last()).toContainText("Which tour");
});

for (const method of ["typed", "calendar"]) {
  test(`a ${method} date change retires a rejected time and shows only current-date departures`, async ({ page, request }) => {
    const { dates } = await selectionSetup(request);
    await toContacts(page, dates);
    const rejected = await sendResult(page, "6am");
    expect(rejected.state.step).toBe("PICK_TIME");
    await expect(page.getByRole("log").locator("p.whitespace-pre-wrap").last()).toContainText("06:00");
    if (method === "calendar") {
      await send(page, "back");
      await choose(page, "Choose " + dates[1]);
    } else await send(page, "Change date to " + dates[1]);
    const latest = page.getByRole("log").locator("p.whitespace-pre-wrap").last();
    await expect(latest).not.toContainText("06:00");
    await expect(page.getByRole("button", { name: "11:00 (4 spots)", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^08:30/ })).toHaveCount(0);
    const currentError = await sendResult(page, "7am");
    expect(currentError.state).toMatchObject({ step: "PICK_TIME", selectedDate: dates[1], pendingTime: "07:00" });
    expect(currentError.buttons).toEqual([{ label: "11:00 (4 spots)", value: "later" }]);
    await expect(latest).toContainText("07:00");
    await expect(latest).not.toContainText("06:00");
    const accepted = await sendResult(page, "btn:later");
    expect(accepted.state).toMatchObject({ step: "ASK_QTY", selectedDate: dates[1], slotId: "later", pendingTime: "11:00" });
    expect(accepted.state.total).toBeUndefined();
  });
}

test("malformed contact fields stay in the draft, explain the right field and preserve saved details", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  await toContacts(page, dates);
  const named = await sendResult(page, "Name: Friday Moyo");
  expect(named.state).toMatchObject({ step: "ASK_DETAILS", name: "Friday Moyo", selectedDate: dates[0] });
  const emailed = await sendResult(page, "Email: wednesday@fixture.invalid");
  expect(emailed.state).toMatchObject({ step: "ASK_DETAILS", email: "wednesday@fixture.invalid", selectedDate: dates[0] });
  const input = page.getByRole("textbox", { name: "Chat message" });
  await input.fill("   ");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await send(page, "María del Carmen de la Cruz Fernández");
  let sent = 0;
  page.on("request", req => { if (req.url() === fixtureUrl + "/functions/v1/web-chat" && req.postDataJSON().message) sent++; });
  for (const [text, field] of [["Email: guest.example.com", "email"], ["Email: guest@@example.com", "email"], ["Email:", "email"], ["Phone: abcdef", "phone"], ["Phone: +44 12", "phone"], ["Name: Other Guest, Email: wrong, Phone: +44 7700 900123", "email"]]) {
    await input.fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("valid " + field);
    await expect(input).toHaveValue(text);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toBeFocused();
    const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem("bt_chat_transcript:a")!).state);
    expect(state).toMatchObject({ step: "ASK_DETAILS", name: "María del Carmen de la Cruz Fernández", email: "wednesday@fixture.invalid", phone: "" });
  }
  expect(sent).toBe(0);
  await page.getByRole("dialog").screenshot({ path: `/private/tmp/bookingtours-chat-contact-error-${test.info().project.name}.png` });
  await send(page, "guest@fixture.invalid");
  await send(page, "+44 (0)20 7946 0958");
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem("bt_chat_transcript:a")!).state);
  expect(state).toMatchObject({ step: "ASK_VOUCHER", name: "María del Carmen de la Cruz Fernández", email: "guest@fixture.invalid", phone: "+442079460958" });
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
});

test("party-size changes apply the count and recheck capacity, changed rates and sold-out inventory", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  await toContacts(page, dates);
  let result = await sendResult(page, "3 people");
  expect(result.state).toMatchObject({ step: "ASK_DETAILS", qty: 3, total: 1800 });
  expect(result.reply).not.toMatch(/how many/i);
  result = await sendResult(page, "Make it 4 people");
  expect(result.state).toMatchObject({ step: "ASK_QTY", qty: 3 });
  expect(result.state.total).toBeUndefined();
  expect(result.reply).toContain("3 spots");
  await request.post(fixtureUrl + "/__fixture/inventory", { data: { id: "slot-a", changes: { available_capacity: 4, price_per_person_override: 700 } } });
  result = await sendResult(page, "Change party size to 4 people");
  expect(result.state).toMatchObject({ step: "ASK_DETAILS", qty: 4, tprice: 700, total: 2800 });
  await request.post(fixtureUrl + "/__fixture/inventory", { data: { id: "slot-a", changes: { available_capacity: 0 } } });
  result = await sendResult(page, "Make it 3 people");
  expect(result.state.step).toBe("PICK_DATE");
  expect(result.state.slotId).toBeFalsy();
  expect(result.state.total).toBeUndefined();
  expect(result.calendar.map((day: any) => day.date)).toEqual([dates[1]]);
  await expect(page.getByRole("button", { name: "Choose " + dates[0], exact: true })).toHaveCount(0);
  await choose(page, "New chat");
  await toContacts(page, dates, "Midday Hike");
  result = await sendResult(page, "Change party size to 6 people");
  expect(result.state).toMatchObject({ step: "ASK_DETAILS", qty: 6, tprice: 750, discount: 225, total: 4275 });
  result = await sendResult(page, "Make it 7 people");
  expect(result.state.step).toBe("ASK_QTY");
  expect(result.reply).toContain("6 spots");
  expect((await (await request.get(fixtureUrl + "/__fixture/state")).json()).rows.bookings).toHaveLength(0);
});

test("an availability network failure preserves the selection and retry uses fresh inventory", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  await toContacts(page, dates);
  await request.post(fixtureUrl + "/__fixture/inventory", { data: { id: "slot-a", changes: {}, failures: { "rpc:list_available_slots": { message: "Fixture unavailable" } } } });
  await send(page, "Change date to " + dates[1]);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("We couldn't confirm a reply");
  const old = await page.evaluate(() => JSON.parse(sessionStorage.getItem("bt_chat_transcript:a")!).state);
  expect(old).toMatchObject({ step: "ASK_DETAILS", slotId: "slot-a", selectedDate: dates[0] });
  await request.post(fixtureUrl + "/__fixture/inventory", { data: { id: "slot-a", changes: {}, failures: { "rpc:list_available_slots": null } } });
  await choose(page, "Retry message");
  await expect(page.getByRole("button", { name: "11:00 (4 spots)", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
});

test("delayed date availability disables repeated choices and keeps date options current", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  await send(page, "book");
  await choose(page, /^Morning Kayak:/);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let count = 0;
  await page.route(fixtureUrl + "/functions/v1/web-chat", async route => {
    if (route.request().postDataJSON().message !== "btn:" + dates[0]) { await route.continue(); return; }
    count++;
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Choose " + dates[0], exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await started;
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeDisabled();
  // The widget retires the old calendar as soon as a choice is submitted.
  await expect(page.getByRole("button", { name: "Choose " + dates[1], exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close chat", exact: true }).click();
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeDisabled();
  expect(count).toBe(1);
  release();
  await expect(page.getByRole("button", { name: "08:30 (3 spots)", exact: true })).toBeVisible();
  const changed = await sendResult(page, "Change date to " + dates[1]);
  expect(changed.state.selectedDate).toBe(dates[1]);
  await expect(page.getByRole("button", { name: "11:00 (4 spots)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^08:30/ })).toHaveCount(0);
});

test("an old availability response finishing after refresh cannot replace a newer date", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  await send(page, "book");
  await choose(page, /^Morning Kayak:/);
  let release!: () => void, entered!: () => void, finished!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const delivered = new Promise<void>(resolve => { finished = resolve; });
  await page.route(fixtureUrl + "/functions/v1/web-chat", async route => {
    if (route.request().postDataJSON().message !== "btn:" + dates[0]) { await route.continue(); return; }
    const response = await route.fetch();
    entered();
    await gate;
    try { await route.fulfill({ response }); } catch { /* refresh may abort this old request */ }
    finally { finished(); }
  });
  await page.getByRole("button", { name: "Choose " + dates[0], exact: true }).click();
  await started;
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-chat-hydrated", "1");
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  const newest = await sendResult(page, "Change date to " + dates[1]);
  expect(newest.state).toMatchObject({ step: "PICK_TIME", selectedDate: dates[1] });
  release();
  await delivered;
  await expect(page.getByRole("button", { name: "11:00 (4 spots)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^08:30/ })).toHaveCount(0);
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem("bt_chat_transcript:a")!).state);
  expect(state.selectedDate).toBe(dates[1]);
});

test("close, reopen and refresh preserve progress and drafts at each step; Restart clears both", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  const input = page.getByRole("textbox", { name: "Chat message" });
  const remember = async (step: string) => {
    const draft = "unsent draft at " + step;
    await input.fill(draft);
    await page.getByRole("button", { name: "Close chat", exact: true }).click();
    await page.getByRole("button", { name: "Open chat", exact: true }).click();
    await expect(input).toHaveValue(draft);
    await page.reload();
    await expect(page.locator("body")).toHaveAttribute("data-chat-hydrated", "1");
    await page.getByRole("button", { name: "Open chat", exact: true }).click();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue(draft);
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("bt_chat_transcript:a")!));
    expect(stored.state.step).toBe(step);
    expect(stored.draft).toBe(draft);
  };
  await send(page, "book");
  await remember("PICK_TOUR");
  await choose(page, /^Morning Kayak:/);
  await remember("PICK_DATE");
  await choose(page, "Choose " + dates[0]);
  await remember("PICK_TIME");
  await choose(page, /^08:30/);
  await remember("ASK_QTY");
  await send(page, "2 people");
  await remember("ASK_DETAILS");
  await choose(page, "New chat");
  await expect(input).toHaveValue("");
  await expect(page.getByRole("log")).toContainText("Let's start fresh");
  await expect(page.getByRole("log")).not.toContainText("Morning Kayak");
  await expect(page.getByRole("button", { name: "Book a Tour", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-chat-hydrated", "1");
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("");
  const fresh = await page.evaluate(() => JSON.parse(sessionStorage.getItem("bt_chat_transcript:a")!));
  expect(fresh.state).toEqual({ step: "IDLE", status: "BOT" });
  expect(fresh.messages).toHaveLength(1);
  expect(fresh.draft).toBe("");
});

test("double clicks, double Send and Enter/Send share one transition; Back, cancel and Restart remain usable", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  await choose(page, "New chat");
  const twice = async (name: string | RegExp) => {
    await page.getByRole("button", { name, exact: typeof name === "string" }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  };
  await twice("Book a Tour");
  await twice(/^Morning Kayak:/);
  await twice("Choose " + dates[0]);
  await twice(/^08:30/);
  await page.getByRole("textbox", { name: "Chat message" }).fill("2 people");
  await twice("Send message");
  await page.getByRole("textbox", { name: "Chat message" }).fill("back");
  await page.getByRole("textbox", { name: "Chat message" }).evaluate(input => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    (document.querySelector('[aria-label="Send message"]') as HTMLButtonElement).click();
  });
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeEnabled();
  await expect(page.getByRole("log").locator("p.whitespace-pre-wrap").last()).toContainText("How many people");
  await send(page, "cancel");
  await expect(page.getByRole("log")).toContainText("stopped this booking request");
  await twice("New chat");
  const fixture = await (await request.get(fixtureUrl + "/__fixture/state")).json();
  const incoming = fixture.rows.chat_messages.filter((message: any) => message.direction === "IN").map((message: any) => message.body);
  for (const text of ["btn:book", "btn:tour-a", "btn:" + dates[0], "btn:slot-a", "2 people", "back", "cancel"]) expect(incoming.filter((body: string) => body === text)).toHaveLength(1);
  expect(fixture.rows.bookings).toHaveLength(0);
  expect(fixture.calls.filter((call: any) => call.kind === "fetch")).toHaveLength(0);
  await expect(page.getByRole("log")).not.toContainText(/btn:|2 people/);
});

test("assistant messages and button labels show plain text and cannot execute untrusted HTML", async ({ page }) => {
  const html = '<img src=x onerror="window.chatInjected=true"><script>window.chatInjected=true</script>';
  await page.route(fixtureUrl + "/functions/v1/web-chat", async route => {
    if (!route.request().postDataJSON().message) { await route.continue(); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ reply: "**Full name** and *Email*: " + html, state: { step: "IDLE" }, buttons: [{ label: "**Continue** " + html, value: "next" }] }) });
  });
  await send(page, "Show the contact instructions");
  await expect(page.getByRole("log")).toContainText("Full name and Email:");
  await expect(page.getByRole("log")).not.toContainText("*");
  expect(await page.evaluate(() => (window as any).chatInjected)).toBeUndefined();
  expect(await page.getByRole("log").locator("script, img").count()).toBe(0);
  await expect(page.getByRole("button", { name: /^Continue <img/ })).toBeVisible();
  await choose(page, /^Continue <img/);
  await expect(page.getByRole("log")).not.toContainText("*");
  expect(await page.evaluate(() => (window as any).chatInjected)).toBeUndefined();
});

test("three mobile widths retain readable contacts, accessible controls and focus without overflow", async ({ page, request }) => {
  const { dates } = await selectionSetup(request);
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 740 });
    await choose(page, "New chat");
    await toContacts(page, dates);
    const input = page.getByRole("textbox", { name: "Chat message" });
    await input.fill("Phone: not a number");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("valid phone");
    await expect(input).toBeFocused();
    const panel = page.getByRole("dialog");
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    const dimensions = await panel.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
    await page.getByRole("button", { name: "New chat", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");
    expect(await panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await panel.screenshot({ path: `/private/tmp/bookingtours-chat-${width}-${test.info().project.name}.png` });
  }
});
