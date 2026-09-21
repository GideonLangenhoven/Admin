import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const workloadPath = root + "docs/production-readiness/WORKLOAD.json";
const executionPath = root + "docs/production-readiness/BT500_EXECUTION.json";
const productionProjectRefs = new Set(["ukdsrndqhsatjkmxijuj"]);
const productionHosts = new Set([
  "admin.bookingtours.co.za",
  "booking.bookingtours.co.za",
  "onboarding.bookingtours.co.za",
]);

function load(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function contractIssues(workload) {
  const issues = [];
  const expect = (condition, message) => { if (!condition) issues.push(message); };
  expect(workload.profile_id === "BT500-LAUNCH-V1", "profile_id must remain BT500-LAUNCH-V1");
  expect(workload.scope?.distinct_authenticated_staff_accounts === 500, "staff account target must be 500");
  expect(workload.scope?.concurrent_active_staff_sessions === 500, "active session target must be 500");
  expect(workload.scope?.synthetic_businesses === 167, "synthetic business target must be 167");
  expect(workload.scope?.accounts_per_business_max === 3 && workload.scope?.final_business_accounts === 2, "account distribution must respect the three-seat database limit");
  expect(workload.staff_actions?.steady_actions_per_second === 50, "staff action rate must be 50/s");
  expect(workload.execution?.ramp_session_levels?.join(",") === "100,250,500", "ramp must remain 100/250/500");
  expect(workload.execution?.steady_full_load_seconds === 3600, "steady run must remain 60 minutes");
  expect(workload.execution?.spike_seconds === 300 && workload.execution?.spike_action_rate_multiplier === 2, "spike must remain 2x for five minutes");
  expect(workload.execution?.soak_elapsed_seconds === 86400, "soak must remain 24 hours");
  expect(workload.thresholds?.unexpected_valid_traffic_failure_rate_lt === 0.001, "valid-traffic failure threshold must remain below 0.1%");
  expect(workload.thresholds?.security_financial_invariant_violations === 0, "security/financial violations must remain zero");
  expect(workload.execution?.qualification_dropped_iterations === 0, "dropped iterations must remain zero");
  expect(workload.safety?.production_load_authorized === false, "production load must remain unauthorized");
  expect(workload.safety?.high_volume_provider_doubles_required === true, "provider doubles must remain required for volume");
  return issues;
}

function safeUrl(value, label, issues) {
  if (!value) return issues.push(label + " is required");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") issues.push(label + " must use HTTPS");
    if (productionHosts.has(url.hostname)) issues.push(label + " points at production");
    if (url.hostname === "localhost" || url.hostname.endsWith(".invalid")) issues.push(label + " is a placeholder");
  } catch {
    issues.push(label + " must be a valid URL");
  }
}

function executionIssues(execution) {
  const issues = [];
  const requiredText = (value, label) => {
    if (typeof value !== "string" || !value.trim()) issues.push(label + " is required");
  };
  if (execution.profile_id !== "BT500-LAUNCH-V1") issues.push("execution profile does not match BT500-LAUNCH-V1");
  if (execution.status !== "APPROVED_FOR_QUALIFICATION") issues.push("status is not APPROVED_FOR_QUALIFICATION");
  if (!/^[0-9a-f]{40}$/.test(execution.candidate_commit || "")) issues.push("an exact candidate_commit is required");
  if (!/^[0-9a-f]{40}$/.test(execution.candidate_tree || "")) issues.push("an exact candidate_tree is required");
  if (execution.candidate_worktree_clean !== true) issues.push("candidate worktree must be clean");
  if (execution.environment?.classification !== "isolated_non_production") issues.push("environment must be classified isolated_non_production");
  requiredText(execution.environment?.supabase_project_ref, "Supabase project ref");
  if (productionProjectRefs.has(execution.environment?.supabase_project_ref)) issues.push("Supabase project ref points at production/shared");
  safeUrl(execution.environment?.admin_url, "Admin URL", issues);
  safeUrl(execution.environment?.booking_url, "Booking URL", issues);
  requiredText(execution.environment?.generator_region, "generator region");
  requiredText(execution.environment?.application_region, "application region");
  if (!(Number(execution.cost?.ceiling_zar) > 0)) issues.push("a positive cost ceiling is required");
  requiredText(execution.window?.starts_at, "window start");
  requiredText(execution.window?.ends_at, "window end");
  const start = Date.parse(execution.window?.starts_at || "");
  const end = Date.parse(execution.window?.ends_at || "");
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start) issues.push("window end must be after window start");
  requiredText(execution.approval?.reference, "approval reference");
  requiredText(execution.approval?.approved_at, "approval timestamp");
  for (const field of ["workload_and_thresholds", "metric_definitions", "realtime_scope", "cost_environment_and_window"]) {
    if (execution.approval?.[field] !== true) issues.push("approval " + field + " is required");
  }
  if (execution.outbound_controls?.live_messages_blocked !== true) issues.push("live messages must be blocked");
  if (execution.outbound_controls?.live_payments_blocked !== true) issues.push("live payments must be blocked");
  if (execution.outbound_controls?.provider_doubles_enabled !== true) issues.push("provider doubles must be enabled");
  for (const [label, path] of Object.entries(execution.required_artifacts || {})) {
    if (!path || !existsSync(root + path)) issues.push(label + " artifact is missing");
  }
  const requiredArtifacts = ["action_mapping", "realtime_topology", "quota_budget", "outbound_guard_evidence"];
  for (const label of requiredArtifacts) if (!(label in (execution.required_artifacts || {}))) issues.push(label + " artifact is required");
  return issues;
}

function report(label, issues) {
  if (!issues.length) return console.log("PASS " + label);
  console.error("BLOCKED " + label);
  for (const issue of issues) console.error("- " + issue);
  process.exitCode = 1;
}

const mode = process.argv[2] || "--contract";
if (mode === "--self-test") {
  const workload = load(workloadPath);
  assert.deepEqual(contractIssues(workload), []);
  const unsafe = load(executionPath);
  assert(executionIssues(unsafe).some(issue => issue.includes("production/shared")));
  assert(executionIssues(unsafe).some(issue => issue.includes("not APPROVED")));
  console.log("PASS BT500 preflight self-test");
} else if (mode === "--contract") {
  report("BT500-LAUNCH-V1 contract", contractIssues(load(workloadPath)));
} else if (mode === "--execute") {
  const contract = contractIssues(load(workloadPath));
  const execution = executionIssues(load(executionPath));
  report("BT500-LAUNCH-V1 execution preflight", [...contract, ...execution]);
} else {
  throw new Error("Use --contract, --execute, or --self-test");
}
