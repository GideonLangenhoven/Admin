import assert from "node:assert/strict";
import test from "node:test";
import { cleanupIssues, mixedCredentialIssues, seedActionIssues } from "../../scripts/bt500-seed-ownership.mjs";

const now = Date.parse("2030-01-01T00:00:00Z");
const candidate = "a".repeat(40);
const execution = {
  status: "APPROVED_FOR_BOUNDED_SMOKE", candidate_commit: candidate,
  environment: { supabase_project_ref: "ukdsrndqhsatjkmxijuj" },
  window: { starts_at: "2029-12-31T23:59:00.000Z", ends_at: "2030-01-01T00:20:00.000Z" },
  approval: { reference: "synthetic-current-window", seed_and_cleanup: true, allowed_operations: ["seed", "sessions", "teardown"] },
};

test("seed and cleanup need current exact action scope", () => {
  assert.deepEqual(seedActionIssues(execution, candidate, "seed", "fixture-1", now), []);
  const stale = structuredClone(execution);
  stale.window.ends_at = "2029-12-31T23:59:59.000Z";
  assert(seedActionIssues(stale, candidate, "seed", "fixture-1", now).some(issue => issue.includes("expired")));
  const oldApproval = structuredClone(execution);
  oldApproval.approval.reference = "user-session-2026-09-21-prelaunch-qualification";
  assert(seedActionIssues(oldApproval, candidate, "teardown", "fixture-1", now).some(issue => issue.includes("fresh exact")));
  const noCleanup = structuredClone(execution);
  noCleanup.approval.allowed_operations = ["seed"];
  assert(seedActionIssues(noCleanup, candidate, "teardown", "fixture-1", now).some(issue => issue.includes("not in the approved")));
});

test("teardown rejects pre-existing marker rows, changed relations and unowned arrivals", () => {
  const marker = "bt500-20260921-0123456789abcdef";
  const inventory = {
    marker, run_id: "fixture-1", project_ref: "ukdsrndqhsatjkmxijuj",
    owned: {
      businesses: [{ id: "business-1", subdomain: `${marker}-01` }],
      tours: [{ id: "tour-1", business_id: "business-1" }],
      slots: [{ id: "slot-1", business_id: "business-1", tour_id: "tour-1" }],
      bookings: [{ id: "booking-1", business_id: "business-1", slot_id: "slot-1", email: `${marker}-1-1@example.invalid` }],
      admin_users: [{ id: "admin-1", business_id: "business-1", user_id: "auth-1", email: `${marker}-001@example.invalid` }],
      auth_users: [{ id: "auth-1", email: `${marker}-001@example.invalid` }],
    },
  };
  const live = {
    businesses: [{ id: "business-1", subdomain: `${marker}-01` }],
    tours: [{ id: "tour-1", business_id: "business-1" }],
    slots: [{ id: "slot-1", business_id: "business-1", tour_id: "tour-1" }],
    bookings: [{ id: "booking-1", business_id: "business-1", slot_id: "slot-1", email: `${marker}-1-1@example.invalid` }],
    admin_users: [{ id: "admin-1", business_id: "business-1", user_id: "auth-1", email: `${marker}-001@example.invalid` }],
    auth_users: [{ id: "auth-1", email: `${marker}-001@example.invalid`, marker }],
    check_ins: [{ id: "arrival-1", booking_id: "booking-1", client_event_id: "bt500-20260921:fixture-1:vu-1:iteration-1", notes: "bt500-20260921:fixture-1" }],
  };
  assert.deepEqual(cleanupIssues(inventory, live), []);
  assert(cleanupIssues(inventory, { ...live, businesses: [...live.businesses, { id: "pre-existing", subdomain: `${marker}-99` }] }).some(issue => issue.includes("unowned live relation")));
  assert(cleanupIssues(inventory, { ...live, bookings: [{ ...live.bookings[0], business_id: "foreign" }] }).some(issue => issue.includes("tenant mismatch")));
  assert(cleanupIssues(inventory, { ...live, auth_users: [{ ...live.auth_users[0], marker: "foreign" }] }).some(issue => issue.includes("Auth marker mismatch")));
  assert(cleanupIssues(inventory, { ...live, check_ins: [{ ...live.check_ins[0], client_event_id: "foreign" }] }).some(issue => issue.includes("unowned arrival")));
  const forged = structuredClone(inventory);
  forged.owned.businesses = [{ id: "real-business", subdomain: "real-customer" }];
  forged.owned.tours = [];
  forged.owned.slots = [];
  forged.owned.bookings = [];
  forged.owned.admin_users = [];
  forged.owned.auth_users = [];
  assert(cleanupIssues(forged, { businesses: [{ id: "real-business", subdomain: "real-customer" }] }).some(issue => issue.includes("planned marker mismatch")));
  const wrongParent = structuredClone(inventory);
  wrongParent.owned.bookings[0].slot_id = "foreign-slot";
  assert(cleanupIssues(wrongParent, live).some(issue => issue.includes("planned marker/parent mismatch")));
});

test("mixed runner rejects repeated owned credentials and wrong tenant links", () => {
  const inventory = { owned: {
    businesses: Array.from({ length: 167 }, (_, i) => ({ id: `business-${i}` })),
    auth_users: [], admin_users: [], bookings: [], slots: [],
  } };
  const credentials = { credentials: [] };
  for (let i = 0; i < 500; i++) {
    const businessId = `business-${Math.floor(i / 3)}`;
    inventory.owned.auth_users.push({ id: `user-${i}` });
    inventory.owned.admin_users.push({ user_id: `user-${i}`, business_id: businessId });
    inventory.owned.bookings.push({ id: `booking-${i}`, business_id: businessId, slot_id: `slot-${i}` });
    inventory.owned.slots.push({ id: `slot-${i}`, business_id: businessId });
    credentials.credentials.push({ user_id: `user-${i}`, business_id: businessId, booking_id: `booking-${i}`, slot_id: `slot-${i}` });
  }
  assert.deepEqual(mixedCredentialIssues(credentials, inventory), []);
  const repeated = { credentials: Array.from({ length: 500 }, () => credentials.credentials[0]) };
  assert(mixedCredentialIssues(repeated, inventory).some(issue => issue.includes("500 distinct")));
  const wrongTenant = structuredClone(credentials);
  wrongTenant.credentials[0].business_id = "foreign";
  assert(mixedCredentialIssues(wrongTenant, inventory).some(issue => issue.includes("ownership/relation mismatch")));
  const concentrated = structuredClone(credentials);
  const concentratedInventory = structuredClone(inventory);
  for (const row of concentrated.credentials) row.business_id = "business-0";
  for (const table of ["admin_users", "bookings", "slots"]) for (const row of concentratedInventory.owned[table]) row.business_id = "business-0";
  assert(mixedCredentialIssues(concentrated, concentratedInventory).some(issue => issue.includes("167 owned businesses")));
});
