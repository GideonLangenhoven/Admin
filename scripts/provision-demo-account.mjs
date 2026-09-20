import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const mode = process.argv[2] || "inspect";
assert(["inspect", "apply", "verify"].includes(mode), "Use inspect, apply, or verify");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(url && serviceKey, "Supabase URL and service-role key are required");
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const EMAIL = "info@bookingtours.co.za";
const PASSWORD = "TEST123!";
const SUBDOMAIN = "claires-hiking";
const BOOKING_BASE_URL = `https://${SUBDOMAIN}.booking.bookingtours.co.za`;
const CHATBOT_AVATAR_URL = "https://lottie.host/b73fce61-6b44-489d-9692-f0a769da24a4/dhP4Oftcxd.lottie";
const TOUR_IMAGE_URLS = {
  "Table Mountain Sunrise Hike": `${BOOKING_BASE_URL}/stock/cape-town.jpg`,
  "Lion's Head Sunset Walk": `${BOOKING_BASE_URL}/stock/mountain.jpg`,
  "Silvermine Fynbos Trail": `${BOOKING_BASE_URL}/stock/hike-alt.jpg`,
};
const REQUEST_ID = "c1a17e50-0000-4000-8000-000000000001";
const id = (suffix) => `c1a17e50-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function fail(error, label) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function findAuthUser(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    fail(error, "List Auth users");
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
}

async function state() {
  const [{ data: admin, error: adminError }, { data: business, error: businessError }] = await Promise.all([
    db.from("admin_users").select("id, business_id, role, suspended, must_set_password, user_id, read_only").eq("email", EMAIL).maybeSingle(),
    db.from("businesses").select("id, business_name, subdomain, subscription_status, yoco_test_mode").eq("subdomain", SUBDOMAIN).maybeSingle(),
  ]);
  return { admin, adminError, business, businessError };
}

if (mode === "inspect") {
  const current = await state();
  console.log(JSON.stringify({
    schemaReady: !current.adminError,
    accountExists: Boolean(current.admin),
    businessExists: Boolean(current.business),
    readOnly: current.admin?.read_only === true,
  }));
  process.exit(0);
}

if (mode === "apply") {
  let current = await state();
  fail(current.adminError, "Read demo administrator (apply the read-only migration first)");
  fail(current.businessError, "Read demo business");

  if (!current.business && !current.admin) {
    const { data: actor, error: actorError } = await db.from("admin_users")
      .select("id").eq("role", "SUPER_ADMIN").eq("suspended", false).limit(1).single();
    fail(actorError, "Find platform administrator");
    const { error } = await db.rpc("platform_onboard_business", {
      p_actor_id: actor.id,
      p_request_id: REQUEST_ID,
      p_business: {
        business_name: "Claire's Hiking",
        business_tagline: "Guided trails, clear views, unforgettable days out.",
        timezone: "Africa/Johannesburg",
        currency: "ZAR",
        logo_url: null,
        subdomain: SUBDOMAIN,
      },
      p_admin: { name: "Claire's Hiking Demo", email: EMAIL },
      p_credentials: {},
      p_key: "",
    });
    fail(error, "Create demo tenant");
    current = await state();
  }

  assert(current.business && current.admin, "Demo email or subdomain is already assigned inconsistently");
  assert(current.admin.business_id === current.business.id, "Demo administrator belongs to another business");

  const existingAuth = await findAuthUser(EMAIL);
  let authUserId = existingAuth?.id;
  if (authUserId) {
    const { error } = await db.auth.admin.updateUserById(authUserId, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { admin_id: current.admin.id, business_id: current.business.id, role: "MAIN_ADMIN", read_only: true },
    });
    fail(error, "Update demo Auth user");
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { admin_id: current.admin.id, business_id: current.business.id, role: "MAIN_ADMIN", read_only: true },
    });
    fail(error, "Create demo Auth user");
    authUserId = data.user.id;
  }

  const logoPath = `${current.business.id}/branding/claires-hiking-logo.png`;
  const logoFile = await readFile(new URL("../public/demo/claires-hiking/logo.png", import.meta.url));
  const { error: logoUploadError } = await db.storage.from("email-images").upload(logoPath, logoFile, {
    contentType: "image/png",
    upsert: true,
  });
  fail(logoUploadError, "Upload Claire's Hiking logo");
  const logoUrl = db.storage.from("email-images").getPublicUrl(logoPath).data.publicUrl;

  const { error: businessUpdateError } = await db.from("businesses").update({
    name: "Claire's Hiking",
    business_name: "Claire's Hiking",
    operator_email: EMAIL,
    notification_email: null,
    public_email: null,
    public_phone: null,
    public_whatsapp: null,
    business_tagline: "Guided trails, clear views, unforgettable days out.",
    logo_url: logoUrl,
    chatbot_avatar: CHATBOT_AVATAR_URL,
    hero_eyebrow: "Walk farther. Feel closer.",
    hero_title: "Cape trails made memorable",
    hero_subtitle: "Small-group guided hikes for curious people who want the story behind the view.",
    color_main: "#173F35",
    color_secondary: "#D9822F",
    color_cta: "#0C8A59",
    timezone: "Africa/Johannesburg",
    currency: "ZAR",
    subdomain: SUBDOMAIN,
    booking_site_url: BOOKING_BASE_URL,
    manage_bookings_url: `${BOOKING_BASE_URL}/my-bookings`,
    booking_success_url: `${BOOKING_BASE_URL}/success`,
    booking_cancel_url: `${BOOKING_BASE_URL}/cancelled`,
    gift_voucher_url: `${BOOKING_BASE_URL}/voucher`,
    voucher_success_url: `${BOOKING_BASE_URL}/voucher-success`,
    waiver_url: `${BOOKING_BASE_URL}/waiver`,
    meeting_point: "Kloof Corner parking area, Tafelberg Road, Cape Town",
    what_to_bring: "Water, sun protection, a light snack, and your sense of adventure.",
    what_to_wear: "Comfortable hiking shoes and weather-ready layers.",
    subscription_status: "ACTIVE",
    yoco_test_mode: true,
    directory_visible: false,
    weather_widget_locations: [],
  }).eq("id", current.business.id);
  fail(businessUpdateError, "Configure demo business");

  const { error: adminUpdateError } = await db.from("admin_users").update({
    name: "Claire's Hiking Demo",
    role: "MAIN_ADMIN",
    password_hash: sha256(PASSWORD),
    password_set_at: new Date().toISOString(),
    must_set_password: false,
    user_id: authUserId,
    suspended: false,
    read_only: true,
    onboarding_completed_at: new Date().toISOString(),
    help_chat_hidden: false,
    settings_permissions: {},
  }).eq("id", current.admin.id);
  fail(adminUpdateError, "Lock demo administrator");

  const tourRows = [
    { id: id(101), business_id: current.business.id, name: "Table Mountain Sunrise Hike", description: "A quiet early-morning ascent with city and ocean views.", image_url: TOUR_IMAGE_URLS["Table Mountain Sunrise Hike"], base_price_per_person: 950, default_capacity: 8, duration_minutes: 240, active: true, hidden: false, sort_order: 1, meeting_point: "Kloof Corner parking area" },
    { id: id(102), business_id: current.business.id, name: "Lion's Head Sunset Walk", description: "A golden-hour guided climb finishing above the Atlantic Seaboard.", image_url: TOUR_IMAGE_URLS["Lion's Head Sunset Walk"], base_price_per_person: 750, default_capacity: 10, duration_minutes: 180, active: true, hidden: false, sort_order: 2, meeting_point: "Lion's Head trail parking" },
    { id: id(103), business_id: current.business.id, name: "Silvermine Fynbos Trail", description: "An easy-paced nature walk through indigenous fynbos and mountain pools.", image_url: TOUR_IMAGE_URLS["Silvermine Fynbos Trail"], base_price_per_person: 620, default_capacity: 12, duration_minutes: 150, active: true, hidden: false, sort_order: 3, meeting_point: "Silvermine Gate 1" },
    { id: id(104), business_id: current.business.id, name: "Cape Point Coastal Hike", description: "A full-day coastal hike with dramatic cliffs, seabirds, and a picnic above the peninsula.", image_url: TOUR_IMAGE_URLS["Lion's Head Sunset Walk"], base_price_per_person: 1250, default_capacity: 8, duration_minutes: 300, active: true, hidden: false, sort_order: 4, meeting_point: "Cape Point main parking area" },
    { id: id(105), business_id: current.business.id, name: "Kirstenbosch Morning Walk", description: "A relaxed guided walk through the gardens, canopy trail, and the lower mountain slopes.", image_url: TOUR_IMAGE_URLS["Silvermine Fynbos Trail"], base_price_per_person: 540, default_capacity: 14, duration_minutes: 120, active: true, hidden: false, sort_order: 5, meeting_point: "Kirstenbosch Garden entrance" },
  ];
  const { error: toursError } = await db.from("tours").upsert(tourRows);
  fail(toursError, "Seed demo tours");

  const zaNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const atLocal = (dayOffset, hour, minute = 0) => new Date(Date.UTC(
    zaNow.getUTCFullYear(), zaNow.getUTCMonth(), zaNow.getUTCDate() + dayOffset, hour - 2, minute,
  )).toISOString();
  const slotRows = [
    [201, 101, -1, 7, 0, 8, 4], [202, 103, -1, 13, 0, 12, 3],
    [203, 102, 0, 17, 30, 10, 5], [204, 101, 0, 7, 0, 8, 2],
    [205, 103, -3, 9, 0, 12, 6], [206, 101, 6, 7, 0, 8, 0],
    [207, 105, 0, 9, 0, 14, 8], [208, 104, 0, 10, 30, 8, 6],
    [209, 102, -2, 17, 30, 10, 7], [210, 101, 1, 7, 0, 8, 6],
    [211, 103, 1, 9, 30, 12, 7], [212, 104, 1, 10, 0, 8, 4],
    [213, 102, 1, 17, 30, 10, 8], [214, 101, 2, 7, 0, 8, 5],
    [215, 102, 2, 16, 30, 10, 7], [216, 105, 3, 9, 0, 14, 6],
    [217, 101, 4, 7, 0, 8, 6], [218, 103, 4, 9, 0, 12, 5],
    [219, 104, 5, 10, 0, 8, 5], [220, 102, 6, 17, 30, 10, 6],
    [221, 105, 7, 8, 0, 14, 4], [222, 101, 8, 7, 0, 8, 2],
    [223, 104, 9, 10, 0, 8, 6], [224, 102, 10, 17, 0, 10, 3],
    [225, 103, 12, 9, 0, 12, 4], [226, 101, 14, 7, 0, 8, 6],
    [227, 105, 16, 9, 0, 14, 4], [228, 104, 18, 10, 0, 8, 5],
    [229, 102, 20, 17, 0, 10, 8], [230, 101, 22, 7, 0, 8, 0],
    [231, 103, 24, 9, 0, 12, 3], [232, 105, 26, 8, 0, 14, 0],
    [233, 104, 28, 10, 0, 8, 5], [234, 102, 30, 17, 0, 10, 0],
  ].map(([slot, tour, day, hour, minute, capacity, booked]) => ({
    id: id(slot), business_id: current.business.id, tour_id: id(tour),
    start_time: atLocal(day, hour, minute), capacity_total: capacity, booked, held: 0, status: "OPEN",
  }));
  const { error: slotsError } = await db.from("slots").upsert(slotRows);
  fail(slotsError, "Seed demo slots");

  const bookingRows = [
    [301, 201, 101, -28, 8, "Amina Jacobs", 2, 950, "COMPLETED", "CAPTURED"],
    [302, 201, 101, -24, 9, "Daniel Naidoo", 2, 950, "COMPLETED", "CAPTURED"],
    [303, 202, 103, -21, 9, "Thandi Mokoena", 3, 620, "COMPLETED", "CAPTURED"],
    [304, 203, 102, -12, 13, "Luca Williams", 3, 750, "PAID", "CAPTURED"],
    [305, 203, 102, -9, 12, "Priya Singh", 2, 750, "PENDING", null],
    [306, 204, 101, -7, 8, "Sam Petersen", 2, 950, "PAID", "CAPTURED"],
    [307, 205, 103, -18, 9, "Nandi Adams", 6, 620, "COMPLETED", "CAPTURED"],
    [308, 206, 101, -2, 15, "Maya Daniels", 2, 950, "CANCELLED", "CAPTURED"],
    [309, 209, 102, -16, 11, "Ethan van der Merwe", 4, 750, "COMPLETED", "CAPTURED"],
    [310, 209, 102, -15, 15, "Zinhle Nkosi", 3, 750, "COMPLETED", "CAPTURED"],
    [311, 207, 105, -10, 8, "Farah Ismail", 2, 540, "PAID", "CAPTURED"],
    [312, 207, 105, -8, 9, "James Botha", 3, 540, "CONFIRMED", "CAPTURED"],
    [313, 207, 105, -1, 10, "Keegan Jacobs", 3, 540, "PENDING", null],
    [314, 208, 104, -7, 11, "Nomsa Dube", 2, 1250, "PAID", "CAPTURED"],
    [315, 208, 104, -6, 15, "Olivia Hart", 4, 1250, "CONFIRMED", "CAPTURED"],
    [316, 210, 101, -6, 10, "Sizwe Mthembu", 2, 950, "PAID", "CAPTURED"],
    [317, 210, 101, -5, 11, "Amber Jansen", 4, 950, "CONFIRMED", "CAPTURED"],
    [318, 211, 103, -5, 9, "Anika de Beer", 4, 620, "PAID", "CAPTURED"],
    [319, 211, 103, -1, 12, "Kabelo Mokoena", 3, 620, "PENDING", null],
    [320, 212, 104, -4, 11, "Tessa Brown", 2, 1250, "CONFIRMED", "CAPTURED"],
    [321, 212, 104, -3, 13, "Ruan Botha", 2, 1250, "PAID", "CAPTURED"],
    [322, 213, 102, -5, 13, "Lihle Khumalo", 4, 750, "PAID", "CAPTURED"],
    [323, 213, 102, -2, 16, "Jamie Lee", 4, 750, "CONFIRMED", "CAPTURED"],
    [324, 214, 101, -6, 10, "Siya Ndlovu", 2, 950, "PAID", "CAPTURED"],
    [325, 214, 101, -1, 11, "Megan Foster", 3, 950, "PENDING", null],
    [326, 215, 102, -8, 12, "Tariq Khan", 3, 750, "PAID", "CAPTURED"],
    [327, 215, 102, -2, 17, "Leah Robinson", 4, 750, "CONFIRMED", "CAPTURED"],
    [328, 216, 105, -7, 9, "Mpho Maseko", 2, 540, "CONFIRMED", "CAPTURED"],
    [329, 216, 105, -3, 10, "Noah Williams", 4, 540, "PAID", "CAPTURED"],
    [330, 217, 101, -6, 11, "Thabo Dlamini", 4, 950, "PAID", "CAPTURED"],
    [331, 217, 101, -1, 12, "Isabelle Martin", 2, 950, "PAID", "CAPTURED"],
    [332, 218, 103, -5, 13, "Caleb Adams", 5, 620, "PAID", "CAPTURED"],
    [333, 219, 104, -5, 14, "Lindiwe Nene", 2, 1250, "CONFIRMED", "CAPTURED"],
    [334, 219, 104, -1, 15, "Alex Kim", 3, 1250, "PENDING", null],
    [335, 220, 102, -3, 14, "Palesa Radebe", 6, 750, "PAID", "CAPTURED"],
    [336, 221, 105, -7, 10, "Jaden Smith", 4, 540, "PAID", "CAPTURED"],
    [337, 222, 101, -6, 12, "Shireen Patel", 2, 950, "PAID", "CAPTURED"],
    [338, 223, 104, -4, 11, "Kyle Johnson", 3, 1250, "PAID", "CAPTURED"],
    [339, 223, 104, -2, 13, "Bianca Ross", 3, 1250, "CONFIRMED", "CAPTURED"],
    [340, 224, 102, -1, 14, "Reece Swanepoel", 3, 750, "PENDING", null],
    [341, 225, 103, -4, 10, "Naledi Molefe", 4, 620, "PAID", "CAPTURED"],
    [342, 226, 101, -5, 11, "Michael Botha", 2, 950, "PAID", "CAPTURED"],
    [343, 226, 101, -1, 16, "Tumi Mkhize", 4, 950, "PAID", "CAPTURED"],
    [344, 227, 105, -3, 13, "Jason Miller", 2, 540, "CONFIRMED", "CAPTURED"],
    [345, 227, 105, -2, 14, "Ayanda Zulu", 2, 540, "PAID", "CAPTURED"],
    [346, 228, 104, -4, 12, "Rose MacLeod", 5, 1250, "PAID", "CAPTURED"],
    [347, 229, 102, -2, 16, "Connor Davis", 4, 750, "CONFIRMED", "CAPTURED"],
    [348, 229, 102, -1, 17, "Zoya Abdullah", 4, 750, "PAID", "CAPTURED"],
    [349, 231, 103, -3, 11, "Wesley Jacobs", 3, 620, "PAID", "CAPTURED"],
    [350, 233, 104, -1, 15, "Sophia van Wyk", 5, 1250, "PAID", "CAPTURED"],
  ].map(([booking, slot, tour, day, hour, name, qty, unit, status, payment]) => {
    const checked = status === "COMPLETED";
    return {
      id: id(booking), business_id: current.business.id, customer_id: id(booking + 600), slot_id: id(slot), tour_id: id(tour),
      customer_name: name, email: `guest-${booking}@example.com`, phone: `+27000000${booking}`,
      qty, unit_price: unit, total_amount: qty * unit, status, source: booking % 3 === 0 ? "WHATSAPP" : "WEBSITE",
      payment_status: payment, payment_method: payment ? "YOCO" : null,
      total_captured: payment ? qty * unit : 0, total_refunded: 0,
      checked_in: checked, checked_in_at: checked ? atLocal(day, hour) : null,
      waiver_status: checked ? "SIGNED" : "PENDING", waiver_signed_at: checked ? atLocal(day, hour) : null,
      created_at: atLocal(day, hour),
      refund_status: booking === 308 ? "REQUESTED" : null, refund_amount: booking === 308 ? 1805 : null,
      custom_fields: {}, waiver_payload: {}, external_source_details: {},
    };
  });
  const paidStatuses = new Set(["PAID", "CONFIRMED", "COMPLETED"]);
  const customerRows = bookingRows.map((booking) => {
    const bookingNumber = Number(booking.id.slice(-12));
    const hasCompletedBooking = paidStatuses.has(booking.status);
    return {
      id: id(bookingNumber + 600), business_id: current.business.id,
      email: booking.email, name: booking.customer_name, phone: booking.phone,
      marketing_consent: bookingNumber % 4 !== 0,
      total_bookings: hasCompletedBooking ? 1 : 0,
      total_spent: hasCompletedBooking ? booking.total_amount : 0,
      first_booking_at: hasCompletedBooking ? booking.created_at : null,
      last_booking_at: hasCompletedBooking ? booking.created_at : null,
      created_at: booking.created_at, updated_at: booking.created_at,
    };
  });
  const { error: customersError } = await db.from("customers").upsert(customerRows);
  fail(customersError, "Seed demo customers");
  const { error: bookingsError } = await db.from("bookings").upsert(bookingRows);
  fail(bookingsError, "Seed demo bookings");

  const { error: invoicesError } = await db.from("invoices").upsert(bookingRows
    .filter((booking) => booking.status !== "CANCELLED")
    .map((booking) => {
      const bookingNumber = Number(booking.id.slice(-12));
      return {
        id: id(bookingNumber + 100), business_id: current.business.id, booking_id: booking.id,
        invoice_number: `CLAIRE-DEMO-${String(bookingNumber - 300).padStart(3, "0")}`,
        customer_name: booking.customer_name, customer_email: booking.email, customer_phone: booking.phone,
        tour_name: tourRows.find((tour) => tour.id === booking.tour_id)?.name || "Guided hike",
        tour_date: slotRows.find((slot) => slot.id === booking.slot_id)?.start_time || booking.created_at,
        qty: booking.qty, unit_price: booking.unit_price, subtotal: booking.total_amount,
        total_amount: booking.total_amount, payment_method: booking.payment_method || "Pending", status: booking.payment_status ? "PAID" : "ISSUED",
        created_at: booking.created_at,
      };
    }));
  fail(invoicesError, "Seed demo invoices");

  const conversations = [
    { id: id(501), phone: "+27000000501", customer_name: "Lerato Khumalo", email: "guest-501@example.com", status: "HUMAN", last_intent: "WEATHER", priority: "HIGH", updated_at: atLocal(0, 10) },
    { id: id(502), phone: "+27000000502", customer_name: "Ben van Wyk", email: "guest-502@example.com", status: "HUMAN", last_intent: "BOOKING", priority: "NORMAL", updated_at: atLocal(0, 9) },
    { id: id(503), phone: "+27000000503", customer_name: "Zola Dlamini", email: "guest-503@example.com", status: "BOT", last_intent: "AVAILABILITY", priority: "NORMAL", updated_at: atLocal(-1, 16) },
  ].map((row) => ({ ...row, business_id: current.business.id, current_state: "IDLE", state_data: {}, last_activity_at: row.updated_at }));
  const { error: conversationsError } = await db.from("conversations").upsert(conversations);
  fail(conversationsError, "Seed demo inbox");
  const demoMessages = [
    { id: id(601), business_id: current.business.id, phone: conversations[0].phone, direction: "INBOUND", body: "Is tomorrow's sunrise hike still going ahead if it is windy?", sender: "CUSTOMER", created_at: atLocal(0, 10), intent: "WEATHER" },
    { id: id(602), business_id: current.business.id, phone: conversations[1].phone, direction: "INBOUND", body: "Can I add one more person to our sunset booking?", sender: "CUSTOMER", created_at: atLocal(0, 9), intent: "BOOKING_CHANGE" },
    { id: id(603), business_id: current.business.id, phone: conversations[2].phone, direction: "OUTBOUND", body: "We have two Silvermine departures available this weekend.", sender: "BOT", created_at: atLocal(-1, 16), auto_replied: true, intent: "AVAILABILITY" },
  ].map((message) => ({ auto_replied: false, ...message }));
  const { error: messagesError } = await db.from("chat_messages").upsert(demoMessages);
  fail(messagesError, "Seed demo messages");

  const { error: reviewsError } = await db.from("reviews").upsert([
    { id: id(701), business_id: current.business.id, tour_id: id(101), booking_id: id(307), source: "NATIVE", status: "APPROVED", rating: 5, reviewer_name: "Nandi A.", comment: "A brilliant guide and the best sunrise view in Cape Town.", submitted_at: atLocal(-1, 11) },
    { id: id(702), business_id: current.business.id, tour_id: id(103), source: "GOOGLE", status: "APPROVED", rating: 5, reviewer_name: "Peter M.", comment: "Relaxed pace, thoughtful stories, and beautiful fynbos.", submitted_at: atLocal(-12, 12) },
    { id: id(703), business_id: current.business.id, tour_id: id(102), source: "NATIVE", status: "PENDING", rating: 4, reviewer_name: "Kim L.", comment: "Wonderful afternoon on Lion's Head.", submitted_at: atLocal(-3, 18) },
  ]);
  fail(reviewsError, "Seed demo reviews");

  const { error: vouchersError } = await db.from("vouchers").upsert([
    { id: id(801), business_id: current.business.id, code: "CLAIRE-DEMO-GIFT", type: "GIFT", status: "ACTIVE", value: 1500, value_amount: 1500, current_balance: 1500, buyer_name: "Demo Buyer", buyer_email: "gift-buyer@example.com", recipient_name: "Demo Recipient", recipient_email: "gift-recipient@example.com", expires_at: atLocal(365, 12) },
    { id: id(802), business_id: current.business.id, code: "CLAIRE-DEMO-CREDIT", type: "CREDIT", status: "ACTIVE", value: 600, value_amount: 600, current_balance: 350, buyer_name: "Demo Buyer", buyer_email: "credit-buyer@example.com", expires_at: atLocal(365, 12) },
  ]);
  fail(vouchersError, "Seed demo vouchers");

  const { error: refreshError } = await db.rpc("refresh_claires_hiking_demo_dates", {
    p_business_id: current.business.id,
  });
  fail(refreshError, "Roll demo dates forward");
}

const final = await state();
fail(final.adminError, "Verify demo administrator");
fail(final.businessError, "Verify demo business");
const authUser = await findAuthUser(EMAIL);
assert(final.admin && final.business && authUser, "Demo account is incomplete");
assert(final.admin.business_id === final.business.id && final.admin.user_id === authUser.id, "Demo identity is not linked");
assert(final.admin.read_only === true && final.admin.suspended === false && final.admin.role === "MAIN_ADMIN", "Demo account is not safely configured");
const [
  { count, error: bookingCountError },
  { count: slotCount, error: slotCountError },
  { count: tourCount, error: tourCountError },
  { data: slots, error: slotsError },
  { data: bookingSeats, error: bookingSeatsError },
] = await Promise.all([
  db.from("bookings").select("id", { count: "exact", head: true }).eq("business_id", final.business.id),
  db.from("slots").select("id", { count: "exact", head: true }).eq("business_id", final.business.id),
  db.from("tours").select("id", { count: "exact", head: true }).eq("business_id", final.business.id),
  db.from("slots").select("id, booked, start_time").eq("business_id", final.business.id),
  db.from("bookings").select("slot_id, qty, status").eq("business_id", final.business.id),
]);
fail(bookingCountError, "Count demo bookings");
fail(slotCountError, "Count demo slots");
fail(tourCountError, "Count demo tours");
fail(slotsError, "Read demo slot capacity");
fail(bookingSeatsError, "Read demo booking seats");
assert((count || 0) >= 50, "Demo fixture needs at least 50 synthetic bookings");
assert((slotCount || 0) >= 34, "Demo fixture needs at least 34 rolling slots");
assert((tourCount || 0) >= 5, "Demo fixture needs at least five active tours");
const activeStatuses = new Set(["PAID", "CONFIRMED", "COMPLETED", "PENDING"]);
const seatsBySlot = new Map();
for (const booking of bookingSeats || []) {
  if (booking.slot_id && activeStatuses.has(booking.status)) {
    seatsBySlot.set(booking.slot_id, (seatsBySlot.get(booking.slot_id) || 0) + Number(booking.qty || 0));
  }
}
const capacityMismatches = (slots || []).filter((slot) => Number(slot.booked || 0) !== (seatsBySlot.get(slot.id) || 0));
assert.equal(capacityMismatches.length, 0, "Demo slot capacity does not match its active bookings");
const localDate = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const slotDates = new Set((slots || []).map((slot) => localDate(new Date(slot.start_time))));
assert(slotDates.has(localDate(new Date())), "Demo needs departures on the current day");
assert(slotDates.has(localDate(tomorrow)), "Demo needs departures on the next day");
console.log(JSON.stringify({ ok: true, business: final.business.business_name, subdomain: final.business.subdomain, readOnly: true, syntheticBookings: count, syntheticSlots: slotCount, activeTours: tourCount }));
