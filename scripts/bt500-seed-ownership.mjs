import { executionWindow } from "./bt500-window.mjs";
import { mixedConfig } from "../tests/stress/bt500-mixed-config.mjs";

const smoke = mixedConfig({ BT500_MODE: "smoke", BT500_RAMP_100: "1s", BT500_RAMP_250: "1s", BT500_RAMP_500: "1s", BT500_STEADY: "2s", BT500_SPIKE: "1s", BT500_RECOVERY: "1s", BT500_SOAK: "0s", BT500_RAMP_DOWN: "1s" });
const tables = ["businesses", "tours", "slots", "bookings", "admin_users", "auth_users"];
const projectRef = "ukdsrndqhsatjkmxijuj";
const oldApproval = "user-session-2026-09-21-prelaunch-qualification";

export function freshApprovalReference(approval) {
  return typeof approval?.reference === "string" && approval.reference.trim().length > 0 && approval.reference !== oldApproval;
}

export function seedActionIssues(execution, candidateCommit, operation, runId, nowMs = Date.now()) {
  const issues = executionWindow(execution?.window, smoke, nowMs).issues;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(runId || "")) issues.push("BT500_RUN_ID is required");
  if (execution?.candidate_commit !== candidateCommit || !/^[0-9a-f]{40}$/.test(candidateCommit || "")) issues.push("seed candidate differs from current source");
  if (execution?.environment?.supabase_project_ref !== projectRef) issues.push("seed project differs from approved target");
  if (!["APPROVED_FOR_QUALIFICATION", "APPROVED_FOR_BOUNDED_SMOKE"].includes(execution?.status)) issues.push("execution status does not allow seeded action");
  if (!freshApprovalReference(execution?.approval)) issues.push("a fresh exact approval reference is required");
  if (execution?.approval?.seed_and_cleanup !== true || !execution.approval.allowed_operations?.includes(operation)) issues.push(`${operation} is not in the approved action scope`);
  if (operation !== "teardown" && execution.window && Date.parse(execution.window.ends_at) - nowMs < 600_000) issues.push("less than ten minutes remain for seed/session work");
  return issues;
}

export function cleanupIssues(inventory, live) {
  const issues = [];
  const marker = inventory?.marker;
  const runPrefix = `bt500-20260921:${inventory?.run_id}:`;
  if (!/^bt500-20260921-[0-9a-f]{16}$/.test(marker || "")) issues.push("inventory marker is invalid");
  if (inventory?.project_ref !== projectRef) issues.push("inventory project is invalid");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(inventory?.run_id || "")) issues.push("inventory run ID is invalid");
  const owned = inventory?.owned || {};
  for (const table of tables) if (!Array.isArray(owned[table])) issues.push(`${table}: inventory IDs are missing`);
  const businesses = new Map((owned.businesses || []).map(row => [row.id, row]));
  const tours = new Map((owned.tours || []).map(row => [row.id, row]));
  const slots = new Map((owned.slots || []).map(row => [row.id, row]));
  const auth = new Map((owned.auth_users || []).map(row => [row.id, row]));
  const markerEmail = (email) => typeof email === "string" && email.startsWith(`${marker}-`) && email.endsWith("@example.invalid");
  for (const row of owned.businesses || []) if (typeof row.id !== "string" || !row.id || !row.subdomain?.startsWith(`${marker}-`)) issues.push(`businesses: planned marker mismatch ${row.id}`);
  for (const row of owned.tours || []) if (typeof row.id !== "string" || !row.id || !businesses.has(row.business_id)) issues.push(`tours: planned parent mismatch ${row.id}`);
  for (const row of owned.slots || []) if (typeof row.id !== "string" || !row.id || !businesses.has(row.business_id) || tours.get(row.tour_id)?.business_id !== row.business_id) issues.push(`slots: planned parent mismatch ${row.id}`);
  for (const row of owned.bookings || []) if (typeof row.id !== "string" || !row.id || !markerEmail(row.email) || !businesses.has(row.business_id) || slots.get(row.slot_id)?.business_id !== row.business_id) issues.push(`bookings: planned marker/parent mismatch ${row.id}`);
  for (const row of owned.admin_users || []) if (typeof row.id !== "string" || !row.id || !markerEmail(row.email) || !businesses.has(row.business_id) || auth.get(row.user_id)?.email !== row.email) issues.push(`admin_users: planned marker/identity mismatch ${row.id}`);
  for (const row of owned.auth_users || []) if (typeof row.id !== "string" || !row.id || !markerEmail(row.email)) issues.push(`auth_users: planned marker mismatch ${row.id}`);
  for (const table of tables) {
    const planned = owned[table] || [];
    const known = new Map(planned.map((row) => [row.id, row]));
    if (known.size !== planned.length) issues.push(`${table}: duplicate inventory IDs`);
    for (const row of live?.[table] || []) {
      const expected = known.get(row.id);
      if (!expected) { issues.push(`${table}: unowned live relation ${row.id}`); continue; }
      if (table === "businesses" && row.subdomain !== expected.subdomain) issues.push(`${table}: marker mismatch ${row.id}`);
      if (["tours", "slots", "bookings", "admin_users"].includes(table) && row.business_id !== expected.business_id) issues.push(`${table}: tenant mismatch ${row.id}`);
      if (table === "slots" && row.tour_id !== expected.tour_id) issues.push(`${table}: tour mismatch ${row.id}`);
      if (table === "bookings" && (row.email !== expected.email || row.slot_id !== expected.slot_id)) issues.push(`${table}: booking marker/relation mismatch ${row.id}`);
      if (table === "admin_users" && (row.email !== expected.email || row.user_id !== expected.user_id)) issues.push(`${table}: staff identity mismatch ${row.id}`);
      if (table === "auth_users" && (row.email !== expected.email || row.marker !== marker)) issues.push(`${table}: Auth marker mismatch ${row.id}`);
    }
  }
  const bookingIds = new Set((owned.bookings || []).map((row) => row.id));
  for (const row of live?.check_ins || []) {
    if (!bookingIds.has(row.booking_id) || !row.client_event_id?.startsWith(runPrefix) || !row.notes?.startsWith(`bt500-20260921:${inventory?.run_id}`)) issues.push(`check_ins: unowned arrival ${row.id}`);
  }
  return issues;
}

export function mixedCredentialIssues(credentials, inventory) {
  const issues = [];
  const users = credentials?.credentials || [];
  const auth = new Map((inventory?.owned?.auth_users || []).map(row => [row.id, row]));
  const staff = new Map((inventory?.owned?.admin_users || []).map(row => [row.user_id, row]));
  const bookings = new Map((inventory?.owned?.bookings || []).map(row => [row.id, row]));
  const slots = new Map((inventory?.owned?.slots || []).map(row => [row.id, row]));
  if (users.length !== 500 || new Set(users.map(row => row.user_id)).size !== 500 || new Set(users.map(row => row.booking_id)).size !== 500) issues.push("credentials need 500 distinct owned staff and write bookings");
  const perBusiness = new Map();
  for (const row of users) perBusiness.set(row.business_id, (perBusiness.get(row.business_id) || 0) + 1);
  const businessOrder = inventory?.owned?.businesses || [];
  if (businessOrder.length !== 167 || perBusiness.size !== 167 || businessOrder.some((business, index) => perBusiness.get(business.id) !== (index === 166 ? 2 : 3))) issues.push("credentials need 167 owned businesses with at most three staff and two in the final business");
  for (const row of users) {
    const staffRow = staff.get(row.user_id), booking = bookings.get(row.booking_id), slot = slots.get(row.slot_id);
    if (!auth.has(row.user_id) || !staffRow || !booking || !slot || staffRow.business_id !== row.business_id || booking.business_id !== row.business_id || booking.slot_id !== row.slot_id || slot.business_id !== row.business_id) {
      issues.push(`credential ownership/relation mismatch for ${row.user_id}`);
    }
  }
  return issues;
}
