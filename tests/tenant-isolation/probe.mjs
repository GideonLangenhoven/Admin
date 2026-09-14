#!/usr/bin/env node

/**
 * Live tenant-isolation probe.
 *
 * Plays the attacker: holds nothing but the public anon key (it ships in every
 * booking page's JavaScript) and a tenant's subdomain (it is the booking site's
 * URL). Tries to reach a DIFFERENT tenant's data through PostgREST.
 *
 * Every probe asserts an expected row count. Any FAIL is an onboarding blocker:
 * one tenant can see another's data.
 *
 * Usage: node tests/tenant-isolation/probe.mjs
 * Exits 0 when every probe passes, 1 otherwise.
 */

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !ANON || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}

// anon = the attacker. service = setup only (picking which tenants to pit
// against each other); never used to satisfy a probe.
const asAnon = (path, headers = {}) =>
  fetch(URL_BASE + path, { headers: { apikey: ANON, Authorization: "Bearer " + ANON, ...headers } });
const rpcAnon = (fn, body) =>
  fetch(URL_BASE + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// A probe that errors is not a pass: an unreachable check proves nothing.
async function rows(path, headers) {
  const res = await asAnon(path, headers);
  const body = await res.json().catch(() => null);
  if (!Array.isArray(body)) return { error: (body && body.message) || "HTTP " + res.status };
  return { rows: body };
}

async function main() {
  // ---- setup: pick two tenants that both hold data ----------------------
  const bizRes = await fetch(
    URL_BASE + "/rest/v1/businesses?select=id,name,subdomain&order=created_at",
    { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE } },
  );
  const businesses = await bizRes.json();
  const counts = await Promise.all(
    businesses.map(async (b) => {
      const r = await fetch(
        URL_BASE + `/rest/v1/bookings?business_id=eq.${b.id}&select=id&limit=1`,
        { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, Prefer: "count=exact" } },
      );
      return { ...b, bookings: Number((r.headers.get("content-range") || "/0").split("/")[1]) };
    }),
  );
  const withData = counts.filter((b) => b.bookings > 0).sort((a, b) => b.bookings - a.bookings);
  if (withData.length < 1) {
    console.error("No tenant has bookings — nothing to probe.");
    process.exit(2);
  }
  const victim = withData[0];
  const attacker = counts.find((b) => b.id !== victim.id);
  console.log(`\nTenants: ${counts.length} live`);
  console.log(`Victim  : ${victim.name} (${victim.subdomain}) — ${victim.bookings} bookings`);
  console.log(`Attacker: ${attacker.name} (${attacker.subdomain})\n`);

  // ---- 1. can an anon caller discover a tenant's id from its subdomain? --
  // Not a leak by itself (the storefront needs it) but it is step 1 of the
  // chain, so the report should say whether the chain even starts.
  const resolve = await rpcAnon("resolve_business_by_subdomain", { p_subdomain: victim.subdomain });
  const resolved = await resolve.json().catch(() => null);
  const gotId = Array.isArray(resolved) ? resolved[0]?.id : resolved?.id;
  console.log(`(context) anon resolve_business_by_subdomain('${victim.subdomain}') -> ${gotId ? "business_id exposed" : "no id"}\n`);

  // ---- 2. anon must not enumerate another tenant's bookings -------------
  const enumRes = await rpcAnon("search_bookings_by_ref", { p_business_id: victim.id, p_ref: "" });
  const enumerated = await enumRes.json().catch(() => []);
  record(
    "anon cannot enumerate a tenant's booking ids (search_bookings_by_ref)",
    !Array.isArray(enumerated) || enumerated.length === 0,
    Array.isArray(enumerated) ? `${enumerated.length} ids returned` : "rejected",
  );

  // ---- 3. a booking id must not be its own read credential --------------
  // If step 2 leaked ids, use one; otherwise fetch one with the service role
  // so this probe still runs standalone.
  let victimBookingId = Array.isArray(enumerated) && enumerated[0]?.id;
  if (!victimBookingId) {
    const r = await fetch(
      URL_BASE + `/rest/v1/bookings?business_id=eq.${victim.id}&select=id&limit=1`,
      { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE } },
    );
    victimBookingId = (await r.json())[0]?.id;
  }
  const tokenRead = await rows(`/rest/v1/bookings?id=eq.${victimBookingId}&select=*`, {
    "x-booking-success-token": victimBookingId,
  });
  record(
    "anon cannot read a booking by presenting its id as the success token",
    tokenRead.rows?.length === 0,
    tokenRead.error || `${tokenRead.rows?.length} rows${tokenRead.rows?.[0]?.email ? " incl. " + tokenRead.rows[0].email : ""}`,
  );

  // ---- 4. baseline: no anon read without any token ----------------------
  const bare = await rows(`/rest/v1/bookings?id=eq.${victimBookingId}&select=id`);
  record("anon cannot read a booking with no token at all", bare.rows?.length === 0, bare.error || `${bare.rows?.length} rows`);

  // ---- 5. spoofing the tenant header must not cross the boundary --------
  // The storefront sends x-tenant-business-id. It is client-supplied, so every
  // table anon can SELECT is probed with the VICTIM's id in that header.
  const baseline = JSON.parse(readFileSync(new URL("../../supabase/security-baseline.json", import.meta.url), "utf8"));
  const anonSelectable = [...new Set(
    baseline.grants.filter((g) => g.grantee === "anon" && g.privilege_type === "SELECT").map((g) => g.table_name),
  )].sort();

  // Deliberately public reads, excluded because they leak nothing the booking
  // site does not already render to any visitor:
  //   per-tenant storefront — a visitor on jerrys.* is meant to see jerrys'
  //     active tours, slots, add-ons, reviews, policies and promotions;
  //   platform-wide — operator_directory (the public operator listing),
  //     plans + platform_public_settings (pricing/config, no business_id),
  //     tour_review_stats (a view of aggregate star ratings already on-page).
  // Anything NOT on this list returning rows to a spoofed header is a leak.
  const PUBLIC_STOREFRONT = new Set([
    "tours", "slots", "add_ons", "reviews", "businesses", "policies", "promotions",
    "chat_faq_entries", "peak_periods",
    "operator_directory", "plans", "platform_public_settings", "tour_review_stats",
  ]);
  const leaks = [];
  for (const table of anonSelectable) {
    const r = await rows(`/rest/v1/${table}?select=*&limit=3`, { "x-tenant-business-id": victim.id });
    if (r.error) continue; // table not exposed / no such relation
    if (r.rows.length > 0 && !PUBLIC_STOREFRONT.has(table)) leaks.push(`${table}(${r.rows.length})`);
  }
  record(
    "spoofed x-tenant-business-id exposes no non-storefront table",
    leaks.length === 0,
    leaks.length ? leaks.join(", ") : `${anonSelectable.length} anon-SELECT tables probed`,
  );

  // ---- 6. cross-tenant voucher redemption -------------------------------
  // A voucher issued by the victim must not validate against the attacker.
  const vRes = await fetch(
    URL_BASE + `/rest/v1/vouchers?business_id=eq.${victim.id}&select=code&limit=1`,
    { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE } },
  );
  const victimVoucher = (await vRes.json())[0]?.code;
  if (victimVoucher) {
    const v = await rows("/rest/v1/vouchers?select=*", {
      "x-voucher-code": victimVoucher,
      "x-tenant-business-id": attacker.id,
    });
    record("a voucher cannot be read through another tenant's storefront", v.rows?.length === 0, v.error || `${v.rows?.length} rows`);
  } else {
    console.log("SKIP  cross-tenant voucher probe — victim has no vouchers");
  }

  // ---- 7. anon must not price another tenant's booking ------------------
  const refund = await rpcAnon("calculate_booking_refund", { p_booking_id: victimBookingId });
  const refundBody = await refund.json().catch(() => null);
  const leaked = refundBody && !refundBody.error && refundBody.amount !== undefined;
  record(
    "anon cannot compute a refund for another tenant's booking",
    !leaked,
    leaked ? `amount=${refundBody.amount}, tour_start=${refundBody.tour_start}` : "rejected",
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} probes passed`);
  if (failed.length) {
    console.log("\nBLOCKERS:");
    for (const f of failed) console.log(`  - ${f.name}  [${f.detail}]`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
