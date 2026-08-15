// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
//
// Token-gated onboarding wizard. The wizard app is anonymous and holds no
// secrets: every request carries a single-use invite token that resolves to
// exactly one skeleton tenant, and nothing here accepts a client-supplied
// business_id. The tenant stays outside the TRADING set until `go-live`, so a
// half-finished wizard cannot take money.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getClientIp, sha256Hex } from "../_shared/otp-attempts.ts";
import { generateSlots } from "../_shared/slot-generation.ts";
import { registerYocoWebhook, validateYocoKey } from "../_shared/yoco.ts";
import {
  isPrivateAddress,
  normaliseRefundTiers,
  parsePublicUrl,
  pickColumns,
  STEP_COLUMNS,
} from "../_shared/onboarding-guards.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";
// The admin console is per tenant: {subdomain}.admin.bookingtours.co.za, and
// AuthGate tells an operator off for landing on someone else's console. So the
// password setup link has to be built from the tenant's own subdomain rather
// than one shared host. ADMIN_APP_URL stays supported as an explicit override
// for non-standard setups.
const ADMIN_DOMAIN = (Deno.env.get("ADMIN_DOMAIN") || "admin.bookingtours.co.za").replace(/^\.+|\/+$/g, "");
const ADMIN_APP_URL = (Deno.env.get("ADMIN_APP_URL") || "").replace(/\/+$/, "");

function adminOriginFor(subdomain?: string | null) {
  if (ADMIN_APP_URL) return ADMIN_APP_URL;
  return subdomain ? `https://${subdomain}.${ADMIN_DOMAIN}` : "";
}
const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

// Per-minute cap per IP per action. Reads are chatty (autosave polling, the
// finish-screen booking poll); anything that reaches a third party or writes
// credentials is kept tight.
const RATE_LIMITS: Record<string, number> = {
  validate: 30,
  "get-state": 30,
  "check-test-booking": 30,
  "save-step": 60,
  "prefill-places": 10,
  "prefill-website": 10,
  "save-credentials": 10,
  "go-live": 5,
  complete: 5,
};

// STEP_COLUMNS (the per-step write whitelist), pickColumns, normaliseRefundTiers
// and the SSRF helpers live in ../_shared/onboarding-guards.ts so they can be
// unit tested — see onboarding-guards.test.ts.

const STEP_ORDER = [
  "identity", "branding", "operations", "refunds",
  "tours", "faqs", "whatsapp", "yoco", "go-live", "done",
];

type Invite = {
  id: string;
  token: string;
  business_id: string;
  client_name: string | null;
  client_email: string | null;
  wizard_step: string | null;
  expires_at: string;
  created_at: string;
};

// Resolves the token to its tenant. Unused + unexpired is the whole gate: a
// consumed or lapsed invite is indistinguishable from a bad one to the caller.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveInvite(token: string): Promise<Invite | null> {
  // A truncated or mistyped link is the common case here, and passing it
  // straight to Postgres answers with "invalid input syntax for type uuid"
  // rather than something a client can act on.
  if (!token || !UUID_RE.test(token)) return null;
  const { data, error } = await supabase
    .from("invite_tokens")
    .select("id, token, business_id, client_name, client_email, wizard_step, expires_at, created_at")
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.business_id) return null;
  return data as Invite;
}

async function withinRateLimit(req: Request, action: string): Promise<boolean> {
  const ip = getClientIp(req);
  if (!ip) return true; // no usable IP: don't lock out a legitimate client
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_ip: ip,
    p_endpoint: "onboarding-wizard:" + action,
    p_max: RATE_LIMITS[action] ?? 30,
  });
  if (error) {
    console.error("rate_limit_check_failed", error);
    return true; // the bucket is a guard rail, not the auth boundary
  }
  return data !== false;
}

async function loadState(invite: Invite) {
  const { data: business, error } = await supabase
    .from("businesses")
    .select(
      "id, name, business_name, business_tagline, business_address, timezone, currency, " +
      "google_place_id, social_google_reviews, operator_email, notification_email, " +
      "logo_url, color_main, color_secondary, color_cta, hero_eyebrow, hero_title, hero_subtitle, " +
      "meeting_point, meeting_point_address, directions, arrival_instructions, what_to_bring, what_to_wear, " +
      "activity_noun, activity_verb_past, refund_policy_tiers, refund_policy_text, faq_json, ai_system_prompt, " +
      "subdomain, booking_site_url, subscription_status, yoco_webhook_status, wa_phone_id_lookup, " +
      "yoco_secret_key_encrypted, wa_token_encrypted"
    )
    .eq("id", invite.business_id)
    .maybeSingle();
  if (error) throw error;
  if (!business) return null;

  const { data: tours } = await supabase
    .from("tours")
    .select("id, name, base_price_per_person, duration_minutes, default_capacity, description, active, sort_order")
    .eq("business_id", invite.business_id)
    .order("sort_order", { ascending: true });

  const tourList = tours || [];
  // Slot counts per tour, so the wizard can show "24 slots created".
  const slotCounts: Record<string, number> = {};
  for (const tour of tourList) {
    const { count } = await supabase
      .from("slots")
      .select("id", { count: "exact", head: true })
      .eq("business_id", invite.business_id)
      .eq("tour_id", tour.id);
    slotCounts[tour.id] = count || 0;
  }

  // Never leak the encrypted blobs themselves — only whether they are set.
  const { yoco_secret_key_encrypted, wa_token_encrypted, ...safeBusiness } = business as Record<string, any>;

  return {
    business: safeBusiness,
    tours: tourList.map((t: any) => ({ ...t, slot_count: slotCounts[t.id] || 0 })),
    creds: {
      yoco_configured: Boolean(yoco_secret_key_encrypted),
      yoco_webhook_status: safeBusiness.yoco_webhook_status || null,
      wa_status: wa_token_encrypted ? "connected" : "pending",
    },
    wizard_step: invite.wizard_step || STEP_ORDER[0],
  };
}

// The scheme/host vetting lives in _shared/onboarding-guards.ts (tested there);
// this adds the DNS half, which needs the runtime.
async function assertPublicUrl(raw: string): Promise<URL> {
  const url = parsePublicUrl(raw);
  const host = url.hostname.toLowerCase();

  // A public hostname can still resolve to a private address, so resolve first
  // and check what it actually points at.
  try {
    const records = [
      ...await Deno.resolveDns(host, "A").catch(() => [] as string[]),
      ...await Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
    ];
    if (records.length && records.every((r) => isPrivateAddress(String(r)))) {
      throw new Error("That host is not reachable.");
    }
  } catch (err) {
    if (err instanceof Error && err.message === "That host is not reachable.") throw err;
    // DNS unavailable in this runtime: the protocol/host checks above still stand.
  }
  return url;
}

async function scrapeSite(rawUrl: string) {
  let url = await assertPublicUrl(rawUrl);

  let res: Response | null = null;
  for (let hop = 0; hop < 3; hop++) {
    res = await fetch(url.toString(), {
      redirect: "manual",
      headers: { "User-Agent": "BookingToursOnboarding/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error("Could not load that website.");

  // Cap the read: we only need the <head>.
  const reader = res.body?.getReader();
  let html = "";
  if (reader) {
    const decoder = new TextDecoder();
    let total = 0;
    while (total < 200_000) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    await reader.cancel().catch(() => {});
  }

  const match = (re: RegExp) => (html.match(re)?.[1] || "").trim() || null;
  const absolute = (href: string | null) => {
    if (!href) return null;
    try { return new URL(href, url).toString(); } catch { return null; }
  };

  return {
    title: match(/<title[^>]*>([^<]{1,200})<\/title>/i),
    description: match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i),
    og_image: absolute(match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)),
    theme_color: match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']{1,32})["']/i),
    favicon: absolute(match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)),
    resolved_url: url.toString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { success: false, error: "Method not allowed" });

  try {
    const body = await req.json();
    const action = String(body.action || "").trim();
    const token = String(body.token || "").trim();

    if (!action) return respond(400, { success: false, error: "action is required" });
    if (!(action in RATE_LIMITS)) return respond(400, { success: false, error: `Unknown action: ${action}` });

    if (!await withinRateLimit(req, action)) {
      return respond(429, { success: false, error: "Too many requests. Give it a minute and try again." });
    }

    const invite = await resolveInvite(token);
    if (!invite) {
      return respond(401, {
        success: false,
        error: "This invite link is invalid, already used, or expired. Ask your onboarding contact for a fresh link.",
      });
    }
    const businessId = invite.business_id;

    // ── validate ──
    if (action === "validate") {
      const { data: business } = await supabase
        .from("businesses")
        .select("business_name, subdomain, booking_site_url")
        .eq("id", businessId)
        .maybeSingle();
      return respond(200, {
        success: true,
        valid: true,
        business_name: business?.business_name || invite.client_name,
        booking_site_url: business?.booking_site_url || null,
        client_name: invite.client_name,
        wizard_step: invite.wizard_step || STEP_ORDER[0],
        expires_at: invite.expires_at,
      });
    }

    // ── get-state ──
    if (action === "get-state") {
      const state = await loadState(invite);
      if (!state) return respond(404, { success: false, error: "This onboarding session's business no longer exists." });
      return respond(200, { success: true, ...state });
    }

    // ── save-step ──
    if (action === "save-step") {
      const step = String(body.step || "").trim();
      const data = (body.data && typeof body.data === "object") ? body.data as Record<string, unknown> : {};

      if (step === "tours") {
        const tours = Array.isArray(body.data?.tours) ? body.data.tours : [];
        const results = [];
        for (const t of tours) {
          const name = String(t?.name || "").trim();
          const price = Number(t?.base_price_per_person);
          const duration = Number(t?.duration_minutes);
          if (!name || !(price > 0) || !(duration > 0)) {
            return respond(400, {
              success: false,
              error: `Every tour needs a name, a price above 0, and a duration above 0. Check "${name || "unnamed tour"}".`,
            });
          }

          const payload = {
            business_id: businessId,
            name,
            base_price_per_person: price,
            duration_minutes: duration,
            default_capacity: Math.max(1, Math.round(Number(t?.default_capacity) || 10)),
            description: String(t?.description || "").trim() || null,
            sort_order: Number(t?.sort_order) || 0,
            active: true,
          };

          let tourId = String(t?.id || "").trim();
          if (tourId) {
            const { error } = await supabase
              .from("tours").update(payload).eq("id", tourId).eq("business_id", businessId);
            if (error) throw error;
          } else {
            const { data: created, error } = await supabase
              .from("tours").insert(payload).select("id").single();
            if (error) throw error;
            tourId = created.id;
          }

          const ranges = Array.isArray(t?.ranges) ? t.ranges : [];
          let slots = { slots_created: 0, slots_skipped: 0 };
          if (ranges.length) {
            const { data: biz } = await supabase
              .from("businesses").select("timezone").eq("id", businessId).maybeSingle();
            const gen = await generateSlots(supabase, {
              business_id: businessId,
              tour_id: tourId,
              capacity: payload.default_capacity,
              timezone: biz?.timezone || "Africa/Johannesburg",
              ranges,
            });
            if (gen.errors.length) throw new Error(gen.errors[0].message);
            slots = { slots_created: gen.slots_created, slots_skipped: gen.slots_skipped };
          }
          results.push({ tour_id: tourId, name, ...slots });
        }

        await supabase.from("invite_tokens").update({ wizard_step: "tours" }).eq("id", invite.id);
        return respond(200, { success: true, saved: "tours", tours: results });
      }

      if (!(step in STEP_COLUMNS)) {
        return respond(400, { success: false, error: `Unknown step: ${step}` });
      }

      const update = pickColumns(step, data);
      if (step === "refunds" && "refund_policy_tiers" in update) {
        const tiers = normaliseRefundTiers(update.refund_policy_tiers);
        if (!tiers) {
          return respond(400, { success: false, error: "Refund policy needs at least one tier." });
        }
        update.refund_policy_tiers = tiers;
      }

      if (Object.keys(update).length) {
        const { error } = await supabase.from("businesses").update(update).eq("id", businessId);
        if (error) throw error;
      }
      await supabase.from("invite_tokens").update({ wizard_step: step }).eq("id", invite.id);
      return respond(200, { success: true, saved: Object.keys(update) });
    }

    // ── prefill-places ──
    if (action === "prefill-places") {
      if (!GOOGLE_PLACES_API_KEY) {
        return respond(503, { success: false, error: "Place lookup is not configured on this environment." });
      }
      const query = String(body.query || "").trim();
      if (!query) return respond(400, { success: false, error: "query is required" });

      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber," +
            "places.websiteUri,places.googleMapsUri,places.regularOpeningHours.weekdayDescriptions",
        },
        body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
      });
      if (!res.ok) {
        return respond(502, { success: false, error: "Place lookup failed. Enter the details by hand." });
      }
      const json = await res.json();
      const candidates = (json.places || []).map((p: any) => ({
        place_id: p.id,
        name: p.displayName?.text || "",
        address: p.formattedAddress || "",
        phone: p.nationalPhoneNumber || "",
        website: p.websiteUri || "",
        maps_uri: p.googleMapsUri || "",
        hours: p.regularOpeningHours?.weekdayDescriptions || [],
      }));
      return respond(200, { success: true, candidates });
    }

    // ── prefill-website ──
    if (action === "prefill-website") {
      const raw = String(body.url || "").trim();
      if (!raw) return respond(400, { success: false, error: "url is required" });
      try {
        return respond(200, { success: true, ...await scrapeSite(raw) });
      } catch (err) {
        return respond(400, { success: false, error: err instanceof Error ? err.message : "Could not read that website." });
      }
    }

    // ── save-credentials ──
    if (action === "save-credentials") {
      const yocoSecretKey = String(body.yoco_secret_key || "").trim();
      if (!yocoSecretKey) return respond(400, { success: false, error: "yoco_secret_key is required" });
      if (!SETTINGS_ENCRYPTION_KEY || SETTINGS_ENCRYPTION_KEY.length < 32) {
        throw new Error("SETTINGS_ENCRYPTION_KEY must be 32+ characters to store credentials.");
      }

      const valid = await validateYocoKey(yocoSecretKey);
      if (!valid.ok) return respond(400, { success: false, error: valid.error });

      // Fail-soft by design: a Yoco API hiccup must not stall a live onboarding
      // call. The validated key is stored either way and CS finishes webhook
      // registration afterwards from the flag.
      const webhookUrl = `${SUPABASE_URL}/functions/v1/yoco-webhook`;
      const registration = await registerYocoWebhook(yocoSecretKey, webhookUrl, "bookingtours");

      const { error: credError } = await supabase.rpc("set_yoco_credentials", {
        p_business_id: businessId,
        p_key: SETTINGS_ENCRYPTION_KEY,
        p_yoco_secret_key: yocoSecretKey,
        p_yoco_webhook_secret: registration.ok ? registration.secret : null,
      });
      if (credError) throw credError;

      const status = registration.ok ? "REGISTERED" : "PENDING_REGISTRATION";
      await supabase.from("businesses").update({ yoco_webhook_status: status }).eq("id", businessId);
      await supabase.from("invite_tokens").update({ wizard_step: "yoco" }).eq("id", invite.id);

      if (!registration.ok) {
        console.warn(`YOCO_WEBHOOK_PENDING business=${businessId}: ${registration.error}`);
      }
      return respond(200, {
        success: true,
        webhook: registration.ok ? "registered" : "pending",
        note: registration.ok
          ? null
          : "Your key is saved. We'll finish connecting payment notifications for you shortly.",
      });
    }

    // ── go-live ──
    if (action === "go-live") {
      const { data: business, error: bizErr } = await supabase
        .from("businesses")
        .select("id, business_name, subdomain, booking_site_url, subscription_status, yoco_webhook_status, yoco_secret_key_encrypted, wa_token_encrypted, wa_phone_id_encrypted")
        .eq("id", businessId)
        .maybeSingle();
      if (bizErr) throw bizErr;
      if (!business) return respond(404, { success: false, error: "Business not found" });

      // Every step below is guarded by an existence check: go-live is safe to
      // press twice, and the CS agent will.

      // 1. Subscription. Without this row the tenant is invisible to platform
      //    invoicing — the gap that left every previously onboarded tenant
      //    un-invoiceable.
      const { data: existingSub } = await supabase
        .from("subscriptions").select("id").eq("business_id", businessId).maybeSingle();
      if (!existingSub) {
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        const { error } = await supabase.from("subscriptions").insert({
          business_id: businessId,
          plan_id: "standard",
          status: "ACTIVE",
          period_start: now.toISOString(),
          period_end: periodEnd.toISOString(),
        });
        if (error) throw error;
      }

      // 2. Loyalty/group-discount policies. wa-webhook does .single() on this
      //    table, so a missing row is an error for the bot, not a default.
      const { data: existingPolicy } = await supabase
        .from("policies").select("business_id").eq("business_id", businessId).maybeSingle();
      if (!existingPolicy) {
        const { error } = await supabase.from("policies").insert({ business_id: businessId });
        if (error) throw error;
      }

      // 3. Main admin + password setup email. Mirrors the `send` half of
      //    app/api/admin/setup-link/route.ts; `complete` still lives there.
      let adminEmailSent = false;
      const clientEmail = String(invite.client_email || "").trim().toLowerCase();
      if (clientEmail) {
        // Look the email up platform-wide, because admin_users.email is unique
        // across tenants — but only ever reuse a row that belongs to THIS
        // tenant. If the address is already somebody else's admin login,
        // carrying on would reset that person's password token and email them.
        // Better to stop and let the agent sort the address out.
        const { data: existingAdmin } = await supabase
          .from("admin_users").select("id, business_id").eq("email", clientEmail).maybeSingle();

        if (existingAdmin && existingAdmin.business_id !== businessId) {
          return respond(409, {
            success: false,
            error: `${clientEmail} is already an admin login on another account. Ask your onboarding contact to finish setup with a different email address.`,
          });
        }

        let adminId = existingAdmin?.id || "";
        if (!adminId) {
          const { data: created, error } = await supabase.from("admin_users").insert({
            business_id: businessId,
            name: invite.client_name || business.business_name,
            email: clientEmail,
            role: "MAIN_ADMIN",
            password_hash: "",
            must_set_password: true,
          }).select("id").single();
          if (error) throw error;
          adminId = created.id;
        }

        const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(24)))
          .map((b) => b.toString(16).padStart(2, "0")).join("");
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        const { error: tokErr } = await supabase.from("admin_users").update({
          setup_token_hash: await sha256Hex(rawToken),
          setup_token_expires_at: expiresAt,
          invite_sent_at: new Date().toISOString(),
          must_set_password: true,
        }).eq("id", adminId);
        if (tokErr) throw tokErr;

        const adminOrigin = adminOriginFor(business.subdomain);
        if (adminOrigin) {
          const setupUrl = `${adminOrigin}/change-password?mode=setup&email=${encodeURIComponent(clientEmail)}&token=${encodeURIComponent(rawToken)}`;
          const { error: mailErr } = await supabase.functions.invoke("send-email", {
            body: {
              type: "ADMIN_WELCOME",
              data: {
                email: clientEmail,
                name: invite.client_name || business.business_name,
                change_password_url: setupUrl,
                expires_at: expiresAt,
                reason: "ADMIN_INVITE",
                business_id: businessId,
              },
            },
          });
          // A bounced welcome email must not undo a completed provision — CS can
          // resend from super-admin.
          if (mailErr) console.error("ONBOARDING_WELCOME_EMAIL_FAILED", businessId, mailErr);
          else adminEmailSent = true;
        }
      }

      // 4. WhatsApp routing hint. Without it the first inbound message falls
      //    back to decrypting every tenant on the platform.
      if (business.wa_phone_id_encrypted) {
        const { data: creds } = await supabase.rpc("get_business_credentials", {
          p_business_id: businessId,
          p_key: SETTINGS_ENCRYPTION_KEY,
        });
        const waPhoneId = Array.isArray(creds) ? creds[0]?.wa_phone_id : (creds as any)?.wa_phone_id;
        if (waPhoneId) {
          await supabase.from("businesses")
            .update({ wa_phone_id_lookup: String(waPhoneId).replace(/\D/g, "") })
            .eq("id", businessId);
        }
      }

      // 5. Open for trade. Last, so a failure above leaves the tenant fenced.
      const { error: statusErr } = await supabase
        .from("businesses").update({ subscription_status: "ACTIVE" }).eq("id", businessId);
      if (statusErr) throw statusErr;

      await supabase.from("invite_tokens").update({ wizard_step: "go-live" }).eq("id", invite.id);

      const { count: tourCount } = await supabase
        .from("tours").select("id", { count: "exact", head: true }).eq("business_id", businessId);
      const { count: slotCount } = await supabase
        .from("slots").select("id", { count: "exact", head: true }).eq("business_id", businessId);

      return respond(200, {
        success: true,
        readiness: {
          subscription: true,
          policies: true,
          admin_email_sent: adminEmailSent,
          yoco: Boolean(business.yoco_secret_key_encrypted),
          webhook: business.yoco_webhook_status || null,
          whatsapp: business.wa_token_encrypted ? "connected" : "pending",
          tours: tourCount || 0,
          slots: slotCount || 0,
          booking_site_url: business.booking_site_url,
          trading: true,
        },
      });
    }

    // ── check-test-booking ──
    if (action === "check-test-booking") {
      const { data: booking, error } = await supabase
        .from("bookings")
        .select("id, ref_code, customer_name, total_amount, status, created_at")
        .eq("business_id", businessId)
        .in("status", ["PAID", "CONFIRMED", "COMPLETED"])
        .gte("created_at", invite.created_at)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return respond(200, { success: true, found: Boolean(booking), booking: booking || null });
    }

    // ── complete ──
    if (action === "complete") {
      // The .is("used_at", null) guard is the single-use enforcement: two
      // concurrent finishes, only one wins.
      const { data: consumed, error } = await supabase
        .from("invite_tokens")
        .update({
          used_at: new Date().toISOString(),
          used_by_email: invite.client_email,
          used_by_business_id: businessId,
          wizard_step: "done",
        })
        .eq("id", invite.id)
        .is("used_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!consumed) return respond(409, { success: false, error: "This onboarding session is already finished." });
      return respond(200, { success: true });
    }

    return respond(400, { success: false, error: `Unhandled action: ${action}` });
  } catch (error) {
    console.error("onboarding-wizard error", error);
    // PostgREST errors are plain objects, not Error instances, so reading
    // .message directly is what surfaces the real cause.
    const e = error as { message?: string; details?: string; code?: string };
    const msg = e?.message || e?.details || (typeof error === "string" ? error : "") || "Unhandled error";
    const friendly = e?.code === "23505"
      ? `That value is already in use (${e.details || e.message}).`
      : msg;
    return respond(500, { success: false, error: friendly });
  }
});
