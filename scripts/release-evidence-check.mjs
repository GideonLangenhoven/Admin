#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const failures = [];
const requireValue = (condition, message) => { if (!condition) failures.push(message); };
const requireEvidence = async (items) => {
  for (const item of items) {
    requireValue(Array.isArray(item.evidence) && item.evidence.length > 0, `${item.id}: evidence is missing`);
    for (const file of item.evidence || []) {
      try { await access(path.join(root, file)); } catch { failures.push(`${item.id}: missing ${file}`); }
    }
  }
};

const mode = process.argv[2];
if (mode === "--section6-map" || mode === "--section6-release") {
  const record = await readJson("docs/production-readiness/SECTION6_COVERAGE.json");
  const requiredIdentities = ["super_admin", "operator", "guide", "public_customer", "suspended_staff", "cross_tenant_actor"];
  const requiredCapabilities = [
    "onboarding", "auth_recovery", "availability", "walkin_online_booking", "pricing_discounts",
    "holds_contention", "checkout_webhooks", "invoices_payments", "vouchers", "refunds_weather",
    "reschedule", "waivers", "arrivals", "reports", "settings_integrations", "messages_marketing",
    "photos_offline"
  ];
  const identities = new Set(record.identities.map((item) => item.id));
  const capabilities = new Set(record.capabilities.map((item) => item.id));
  for (const id of requiredIdentities) requireValue(identities.has(id), `missing identity ${id}`);
  for (const id of requiredCapabilities) requireValue(capabilities.has(id), `missing capability ${id}`);
  requireValue(record.continuity.required_accounts === 100, "continuity target must remain 100 accounts");
  await requireEvidence([...record.identities, ...record.capabilities]);
  if (mode === "--section6-release") {
    requireValue(record.status === "PASSED", `Section 6 status is ${record.status}`);
    requireValue(record.continuity.completed_accounts >= 100, "100-account continuity has not run");
    requireValue(record.provider_journeys.genuine_sandbox_completed === true, "genuine provider sandbox journeys have not run");
    requireValue(record.browser_role_matrix.completed === true, "browser role matrix has not run");
  }
} else if (mode === "--section9") {
  const handoff = await readJson("docs/production-readiness/evidence/SECTION9_HANDOFF.json");
  for (const key of ["verdict", "candidate", "routing", "accepted_fixes", "test_results", "section6", "section7", "existing_customer_continuity", "migration_provider_restore", "deployment_canary", "residual_risks", "approvals"]) {
    requireValue(handoff[key] !== undefined, `handoff field ${key} is missing`);
  }
  const ready = new Set(["ROLLOUT_READY_500", "READY_FOR_APPROVED_PRODUCTION_DEPLOYMENT"]);
  if (handoff.section7.executed !== true) requireValue(!ready.has(handoff.verdict), "unexecuted Section 7 cannot carry a ready verdict");
  requireValue(handoff.scope_override?.section9_may_complete_without_section7 === true, "Section 9 scope override is missing");
  requireValue(handoff.scope_override?.does_not_waive_qualification === true, "qualification waiver boundary is missing");
  requireValue(handoff.handoff_validation === "PASS", "handoff validation is not PASS");
} else {
  console.error("usage: node scripts/release-evidence-check.mjs --section6-map|--section6-release|--section9");
  process.exit(2);
}

if (failures.length) {
  console.error(`FAIL (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`PASS ${mode}`);
