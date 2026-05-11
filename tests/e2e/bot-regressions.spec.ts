import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "ukdsrndqhsatjkmxijuj";
const BUSINESS_ID = process.env.BOT_E2E_BUSINESS_ID || "c8b439f5-c11e-4d46-b347-943df6f172b4";
const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL || `https://${PROJECT_REF}.supabase.co/functions/v1`;
const SUPABASE_URL = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const LIVE_BOT_E2E = process.env.LIVE_BOT_E2E === "1";
const WA_APP_SECRET = process.env.WA_APP_SECRET || "";
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || "";

type SlotFixture = {
  slotId: string;
  tourId: string;
  unitPrice: number;
  startTime: string;
};

function serviceClient() {
  expect(SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY is required for live bot regressions").not.toBe("");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findBookableSlot(): Promise<SlotFixture> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("slots")
    .select("id,start_time,tour_id,price_per_person_override,tours!inner(id,base_price_per_person)")
    .eq("business_id", BUSINESS_ID)
    .eq("status", "OPEN")
    .gt("start_time", new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString())
    .order("start_time", { ascending: true })
    .limit(1);

  expect(error).toBeNull();
  expect(data?.length, "Need at least one future OPEN slot for bot regression tests").toBeGreaterThan(0);

  const slot = data![0] as any;
  const tour = Array.isArray(slot.tours) ? slot.tours[0] : slot.tours;
  return {
    slotId: slot.id,
    tourId: slot.tour_id,
    startTime: slot.start_time,
    unitPrice: Number(slot.price_per_person_override ?? tour.base_price_per_person),
  };
}

async function countRecentBookingsForEmail(email: string) {
  const supabase = serviceClient();
  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("business_id", BUSINESS_ID)
    .eq("email", email)
    .gt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

  expect(error).toBeNull();
  return count || 0;
}

function signWhatsAppPayload(rawBody: string) {
  return "sha256=" + createHmac("sha256", WA_APP_SECRET).update(rawBody).digest("hex");
}

function whatsappPayload(phone: string, text: string) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "bot-regression",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "27000000000",
            phone_number_id: WA_PHONE_NUMBER_ID,
          },
          contacts: [{ wa_id: phone, profile: { name: "Bot Regression" } }],
          messages: [{
            from: phone,
            id: `bot-regression-${Date.now()}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: "text",
            text: { body: text },
          }],
        },
      }],
    }],
  };
}

test.describe("bot booking regressions", () => {
  test("webchat lists Sunset Paddle and corrects stale zero-price confirmations", async ({ request }) => {
    test.skip(!LIVE_BOT_E2E, "Set LIVE_BOT_E2E=1 to run live bot regression tests.");

    const slot = await findBookableSlot();
    const email = `webchat-regression-${Date.now()}@example.com`;

    const bookResponse = await request.post(`${FUNCTIONS_URL}/web-chat`, {
      data: {
        message: "book",
        state: { step: "IDLE" },
        business_id: BUSINESS_ID,
      },
    });
    expect(bookResponse.ok()).toBe(true);
    const bookJson = await bookResponse.json();
    expect(bookJson.buttons?.map((button: any) => button.label)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Morning Kayak/i),
        expect.stringMatching(/Sunset Paddle/i),
      ]),
    );

    const staleResponse = await request.post(`${FUNCTIONS_URL}/web-chat`, {
      data: {
        message: "confirm",
        buttonValue: "confirm",
        state: {
          step: "CONFIRM",
          bid: BUSINESS_ID,
          tid: slot.tourId,
          slotId: slot.slotId,
          slotTime: slot.startTime,
          qty: 5,
          total: 0,
          baseTotal: 0,
          discount: 0,
          customerName: "Webchat Regression",
          email,
          phone: "+27710000000",
          vded: 0,
        },
      },
    });
    expect(staleResponse.ok()).toBe(true);
    const staleJson = await staleResponse.json();
    expect(staleJson.reply).toContain("The price has changed");
    expect(staleJson.state.total).toBe(5 * slot.unitPrice);
    expect(staleJson.buttons?.[0]?.label).toMatch(/Confirm & Pay/i);
    await expect.poll(() => countRecentBookingsForEmail(email)).toBe(0);
  });

  test("WhatsApp webhook corrects stale zero-price confirmation before booking insert", async ({ request }) => {
    test.skip(!LIVE_BOT_E2E, "Set LIVE_BOT_E2E=1 to run live bot regression tests.");
    test.skip(!WA_APP_SECRET || !WA_PHONE_NUMBER_ID, "WA_APP_SECRET and WA_PHONE_NUMBER_ID are required to sign a live WhatsApp webhook.");

    const supabase = serviceClient();
    const slot = await findBookableSlot();
    const phone = `2782${String(Date.now()).slice(-8)}`;
    const email = `wa-regression-${Date.now()}@example.com`;

    const { error: seedError } = await supabase
      .from("conversations")
      .upsert({
        business_id: BUSINESS_ID,
        phone,
        status: "BOT",
        current_state: "FINALIZE_BOOKING",
        state_data: {
          tour_id: slot.tourId,
          slot_id: slot.slotId,
          slotTime: slot.startTime,
          qty: 5,
          unit_price: 0,
          base_total: 0,
          total: 0,
          customer_name: "WhatsApp Regression",
          email,
          voucher_deduction: 0,
        },
      }, { onConflict: "business_id,phone" });
    expect(seedError).toBeNull();

    const payload = whatsappPayload(phone, "confirm");
    const rawBody = JSON.stringify(payload);
    const response = await request.post(`${FUNCTIONS_URL}/wa-webhook`, {
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signWhatsAppPayload(rawBody),
      },
      data: rawBody,
    });
    expect(response.ok()).toBe(true);

    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .select("current_state,state_data")
      .eq("business_id", BUSINESS_ID)
      .eq("phone", phone)
      .single();

    expect(convoError).toBeNull();
    expect(convo?.current_state).toBe("CONFIRM_BOOKING");
    expect(Number((convo?.state_data as any)?.total)).toBe(5 * slot.unitPrice);
    await expect.poll(() => countRecentBookingsForEmail(email)).toBe(0);
  });
});
