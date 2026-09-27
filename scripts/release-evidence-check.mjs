#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const hex40 = /^[0-9a-f]{40}$/;
const hex64 = /^[0-9a-f]{64}$/;

// Each item needs its own retained run/result artifact. Old filenames and status flags do not qualify it.
export const REQUIRED_PROOFS = [
  "source_security", "migration_rehearsal", "deployed_provenance", "migration_apply",
  "effective_configuration", "section6_continuity", "section6_role_matrix",
  "genuine_provider_journeys", "financial_faults", "outbound_guard_negatives",
  "provider_double_public_jobs", "representative_data_quota", "realtime_browser",
  "bt500_mixed_60m", "bt500_spike_recovery", "bt500_soak_24h",
  "alert_delivery", "isolated_restore", "production_canary",
];
const BEFORE_DEPLOY = new Set(["source_security", "migration_rehearsal"]);
const BEFORE_CONFIG = new Set([...BEFORE_DEPLOY, "deployed_provenance", "migration_apply"]);
const SECTION6_PROOFS = ["section6_continuity", "section6_role_matrix", "genuine_provider_journeys", "financial_faults"];
const CANDIDATE_KEYS = [
  "admin_commit", "admin_tree", "admin_lock_sha256", "booking_commit", "booking_tree",
  "booking_lock_sha256", "onboarding_commit", "onboarding_tree", "onboarding_lock_sha256",
  "supabase_project", "profile_id",
];

export function sourceMatchesCandidate(directory, candidateCommit) {
  if (!hex40.test(candidateCommit || "")) return false;
  try {
    const git = (args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
    const changed = git(["diff", "--name-only", candidateCommit, "--"]).split("\n");
    const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n");
    const recordFiles = new Set(["00_START_HERE.md", "STATE.md", "RELEASE_REPORT.md", "SECTION7_QUALIFICATION.md", "SECTION8_RELEASE_RECOVERY.md", "SECTION9_HANDOFF.md", "RELEASE_MANIFEST.json", "CLOSEOUT_PACKET.json", "ISSUES.json", "APPROVALS.json"]);
    const isReadinessRecord = (file) => recordFiles.has(file.replace("docs/production-readiness/", ""))
      || file.startsWith("docs/production-readiness/reviews/")
      || (file.startsWith("docs/production-readiness/evidence/") && !file.startsWith("docs/production-readiness/evidence/scripts/"));
    return [...changed, ...untracked].filter(Boolean).every(isReadinessRecord);
  } catch { return false; }
}

function machineIssues(id, raw, packet, observedAt) {
  const issues = [];
  const need = (ok, field) => { if (!ok) issues.push(`${id}: machine result ${field} failed or is missing`); };
  const atLeast = (value, minimum) => typeof value === "number" && Number.isFinite(value) && value >= minimum;
  const atMost = (value, maximum) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
  if (["bt500_mixed_60m", "bt500_spike_recovery", "bt500_soak_24h", "production_canary"].includes(id)) {
    const start = Date.parse(raw?.started_at_utc), end = Date.parse(raw?.ended_at_utc);
    need(typeof raw?.started_at_utc === "string" && raw.started_at_utc.endsWith("Z") && typeof raw?.ended_at_utc === "string" && raw.ended_at_utc.endsWith("Z") && Number.isFinite(start) && Number.isFinite(end) && end > start && end <= Date.parse(observedAt) && atLeast(raw?.duration_seconds, 1) && Math.abs((end - start) / 1000 - raw.duration_seconds) <= 1, "UTC interval/duration");
  }
  need(raw?.id === id && raw?.status === "PASS" && raw?.exit_code === 0, "status/exit");
  for (const key of CANDIDATE_KEYS) need(raw?.candidate?.[key] === packet.candidate?.[key], `candidate ${key}`);
  if (!BEFORE_DEPLOY.has(id)) for (const key of ["admin", "booking", "onboarding"]) need(raw?.deployment_ids?.[key] === packet.deployment_ids?.[key], `${key} deployment`);
  if (!BEFORE_CONFIG.has(id)) need(raw?.config_fingerprint === packet.config_fingerprint, "configuration fingerprint");
  const checks = {
    source_security: () => raw.unresolved_high_critical === 0 && raw.security_checks_passed === true,
    migration_rehearsal: () => raw.reconciliation_passed === true && raw.rollback_plan_checked === true && JSON.stringify(raw.migration_versions) === JSON.stringify(packet.migration_versions),
    deployed_provenance: () => raw.source_commits?.admin === packet.candidate.admin_commit && raw.source_commits?.booking === packet.candidate.booking_commit && raw.source_commits?.onboarding === packet.candidate.onboarding_commit && atLeast(raw.edge_function_count, 55),
    migration_apply: () => raw.reconciliation_passed === true && JSON.stringify(raw.migration_versions) === JSON.stringify(packet.migration_versions),
    effective_configuration: () => raw.shared_limiter_ready === true && raw.trusted_recovery_origin === true && raw.bypass_disabled === true && raw.secrets_redacted === true,
    section6_continuity: () => atLeast(raw.completed_accounts, 100) && raw.identity_links_preserved === true && raw.pending_work_reconciled === true,
    section6_role_matrix: () => raw.role_matrix_passed === true && raw.cross_tenant_denials_passed === true && raw.suspended_denials_passed === true,
    genuine_provider_journeys: () => raw.genuine_sandbox_completed === true && raw.simulated === false && raw.yoco_payment_webhook_refund === true && raw.email_received === true && raw.whatsapp_received === true,
    financial_faults: () => raw.contention_passed === true && raw.invariant_violations === 0 && raw.unknown_outcomes_reconciled === true,
    outbound_guard_negatives: () => raw.non_marker_rejected === true && raw.unapproved_recipient_rejected === true && raw.live_payment_rejected === true && raw.missing_double_rejected === true && raw.unsafe_teardown_rejected === true,
    provider_double_public_jobs: () => raw.provider_doubles_enabled === true && atLeast(raw.public_actions_per_second, 5) && atLeast(raw.checkout_per_second, 0.5) && atLeast(raw.webhook_per_second, 1.25) && atLeast(raw.transactional_jobs_completed, 500) && atMost(raw.transactional_burst_seconds, 600),
    representative_data_quota: () => atLeast(raw.bookings, 250000) && atLeast(raw.slots, 62500) && atLeast(raw.customer_relationships, 25000) && atLeast(raw.message_audit_rows, 500000) && atLeast(raw.busy_tenant_bookings, 25000) && atLeast(raw.sustained_headroom_fraction, 0.3) && raw.incremental_cost_zar === 0,
    realtime_browser: () => atLeast(raw.browser_connections, 500) && atLeast(raw.shell_bindings, 1000) && atMost(raw.update_p95_ms, 2000) && raw.unrecovered_disconnects === 0,
    bt500_mixed_60m: () => raw.mode === "qualification" && atLeast(raw.duration_seconds, 3600) && atLeast(raw.active_sessions, 500) && atLeast(raw.unique_staff_accounts, 500) && atLeast(raw.steady_staff_actions_per_second, 50) && raw.staff_action_mix?.read === 0.7 && raw.staff_action_mix?.write === 0.2 && raw.staff_action_mix?.other === 0.1 && atLeast(raw.public_actions_per_second, 5) && atLeast(raw.checkout_per_second, 0.5) && atLeast(raw.webhook_per_second, 1.25) && atLeast(raw.transactional_jobs_completed, 500) && raw.provider_doubles_enabled === true && raw.marketing_active === true && atMost(raw.read_p95_ms, 750) && atMost(raw.read_p99_ms, 1500) && atMost(raw.write_p95_ms, 1500) && atMost(raw.write_p99_ms, 3000) && atMost(raw.valid_failure_rate, 0.001 - Number.EPSILON) && raw.dropped_iterations === 0 && raw.invariant_violations === 0 && raw.thresholds_passed === true && raw.load_exit_code === 0 && raw.invariant_exit_code === 0 && raw.mixed_runner_complete === true,
    bt500_spike_recovery: () => raw.mode === "qualification" && atLeast(raw.spike_rate_multiplier, 2) && atLeast(raw.spike_seconds, 300) && atMost(raw.recovery_seconds, 600) && atLeast(raw.duration_seconds, raw.spike_seconds + raw.recovery_seconds) && raw.lost_or_duplicate_financial_work === 0 && raw.thresholds_passed === true,
    bt500_soak_24h: () => raw.mode === "qualification" && atLeast(raw.duration_seconds, 86400) && raw.continuous === true && atLeast(raw.active_sessions, 500) && raw.growing_resource_leak === false && raw.thresholds_passed === true,
    alert_delivery: () => raw.alert_received === true && raw.owner_acknowledged === true && raw.missed_scheduler_covered === true && raw.aged_jobs_covered === true,
    isolated_restore: () => typeof raw.restore_target === "string" && raw.restore_target.length > 0 && raw.restore_target !== packet.candidate.supabase_project && atMost(raw.rpo_seconds, 900) && atMost(raw.rto_seconds, 3600) && raw.database_restored === true && raw.auth_restored === true && raw.private_files_restored === true && raw.protected_config_restored === true,
    production_canary: () => atLeast(raw.duration_seconds, 86400) && JSON.stringify(raw.cohort_steps) === "[5,25,100,250,500]" && raw.scheduled_jobs_exercised === true && raw.health_gates_passed === true,
  };
  need(checks[id]?.() === true, "required measurements");
  return issues;
}

export async function releaseIssues({ directory, manifest, packet, checkout, proofIds = REQUIRED_PROOFS, requireClean = true, nowMs = Date.now() }) {
  const failures = [];
  const expect = (ok, message) => { if (!ok) failures.push(message); };
  const candidate = packet?.candidate || {};
  const selected = manifest?.current_candidate || {};
  expect(packet?.schema_version === 1, "current closeout packet schema is missing");
  for (const key of CANDIDATE_KEYS) {
    expect(Boolean(candidate[key]) && candidate[key] === selected[key], `candidate ${key} differs from current manifest`);
  }
  for (const key of ["admin_commit", "admin_tree", "booking_commit", "booking_tree", "onboarding_commit", "onboarding_tree"]) {
    expect(hex40.test(candidate[key] || ""), `candidate ${key} must be an exact Git ID`);
  }
  for (const key of ["admin_lock_sha256", "booking_lock_sha256", "onboarding_lock_sha256"]) {
    expect(hex64.test(candidate[key] || ""), `candidate ${key} must be a SHA-256`);
  }
  expect(checkout.candidateTree === candidate.admin_tree, "Admin CI commit tree differs from candidate");
  if (proofIds.length) expect(checkout.sourceMatches, "Admin source or harness differs from source CI commit");
  if (requireClean) expect(checkout.clean, "Admin checkout has uncommitted changes");
  const lock = await readFile(path.join(directory, "package-lock.json"));
  expect(createHash("sha256").update(lock).digest("hex") === candidate.admin_lock_sha256, "Admin lockfile hash differs from candidate");
  const ci = packet?.source_ci || {};
  expect(ci.conclusion === "SUCCESS" && ci.admin_commit === candidate.admin_commit, "source CI is not successful on the exact Admin candidate");
  expect(Number.isSafeInteger(ci.run_id) && ci.run_id > 0 && /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(ci.url || "") && ci.url.endsWith(`/runs/${ci.run_id}`), "source CI run ID/URL is missing or mismatched");
  expect(ci.run_id === selected.source_ci?.run_id && ci.admin_commit === selected.source_ci?.admin_commit, "source CI differs from current manifest");
  expect(packet?.verdict === "FAILED_GATE" || packet?.verdict === "ROLLOUT_READY_500", "closeout verdict is invalid");

  if (proofIds.length) {
    const deployments = packet?.deployment_ids;
    expect(deployments && ["admin", "booking", "onboarding"].every((key) => /^dpl_[A-Za-z0-9]+$/.test(deployments[key] || "")), "exact three-application deployment IDs are missing");
    expect(hex64.test(packet?.config_fingerprint || ""), "effective configuration fingerprint is missing");
    expect(Array.isArray(packet?.migration_versions) && packet.migration_versions.length > 0 && packet.migration_versions.every((version) => /^\d{14}$/.test(version)), "exact forward migration versions are missing");
    expect(JSON.stringify(packet.migration_versions) === JSON.stringify((manifest?.planned_unapplied_migrations || []).map((file) => /\/(\d{14})_/.exec(file)?.[1])), "forward migration versions differ from current manifest");
  }
  const machineResults = new Map();
  for (const id of proofIds) {
    const reference = packet?.proofs?.[id];
    if (!reference) { failures.push(`${id}: retained result is missing`); continue; }
    const file = reference.file;
    if (typeof file !== "string" || !file.startsWith("docs/production-readiness/evidence/") || file.split("/").includes("..")) {
      failures.push(`${id}: evidence path must stay under readiness evidence`);
      continue;
    }
    if (!hex64.test(reference.sha256 || "")) { failures.push(`${id}: artifact SHA-256 is missing`); continue; }
    let bytes, result;
    try { bytes = await readFile(path.join(directory, file)); result = JSON.parse(bytes); }
    catch { failures.push(`${id}: result artifact is missing or invalid JSON`); continue; }
    expect(createHash("sha256").update(bytes).digest("hex") === reference.sha256, `${id}: artifact hash differs`);
    expect(result.id === id && result.status === "PASS", `${id}: result is not PASS`);
    expect(result.exit_code === 0, `${id}: checker exit code is not zero`);
    expect(typeof result.run_id === "string" && result.run_id.length > 0 && typeof result.source === "string" && result.source.length > 0, `${id}: run/source identity is missing`);
    expect(typeof result.observed_at_utc === "string" && Number.isFinite(Date.parse(result.observed_at_utc)) && Date.parse(result.observed_at_utc) <= nowMs && result.observed_at_utc.endsWith("Z"), `${id}: UTC observation time is missing or in the future`);
    expect(Array.isArray(result.raw_artifacts) && result.raw_artifacts.length > 0, `${id}: raw run artifact is missing`);
    for (const [index, raw] of (result.raw_artifacts || []).entries()) {
      if (typeof raw.file !== "string" || !raw.file.startsWith("docs/production-readiness/evidence/") || raw.file.split("/").includes("..") || !hex64.test(raw.sha256 || "")) {
        failures.push(`${id}: raw artifact reference is invalid`);
        continue;
      }
      try {
        const rawBytes = await readFile(path.join(directory, raw.file));
        expect(createHash("sha256").update(rawBytes).digest("hex") === raw.sha256, `${id}: raw artifact hash differs`);
        if (index === 0) {
          if (raw.kind !== "machine_result" || !raw.file.endsWith(".json")) failures.push(`${id}: first raw artifact must be a machine result JSON`);
          else {
            try { const machine = JSON.parse(rawBytes); machineResults.set(id, machine); failures.push(...machineIssues(id, machine, packet, result.observed_at_utc)); }
            catch { failures.push(`${id}: machine result is invalid JSON`); }
          }
        } else if (raw.file.endsWith(".json")) {
          try {
            const value = JSON.parse(rawBytes);
            const thresholdFailed = Object.values(value.metrics || {}).some((metric) => Object.values(metric.thresholds || {}).some((rule) => rule.ok === false));
            if (/FAIL|ERROR/.test(String(value.status || "")) || value.exit_code > 0 || value.load_exit_code > 0 || value.invariant_exit_code > 0 || value.thresholds_passed === false || value.mixed_runner_complete === false || thresholdFailed) failures.push(`${id}: supporting raw result failed`);
          } catch { failures.push(`${id}: supporting raw JSON is invalid`); }
        }
      } catch { failures.push(`${id}: raw artifact is missing`); }
    }
    for (const key of CANDIDATE_KEYS) expect(result.candidate?.[key] === candidate[key], `${id}: candidate ${key} differs`);
    if (!BEFORE_DEPLOY.has(id)) {
      for (const key of ["admin", "booking", "onboarding"]) expect(result.deployment_ids?.[key] === packet.deployment_ids?.[key], `${id}: ${key} deployment differs`);
    }
    if (!BEFORE_CONFIG.has(id)) expect(result.config_fingerprint === packet.config_fingerprint, `${id}: configuration fingerprint differs`);
  }
  if (machineResults.has("bt500_soak_24h") && machineResults.has("production_canary")) {
    expect(Date.parse(machineResults.get("production_canary").started_at_utc) >= Date.parse(machineResults.get("bt500_soak_24h").ended_at_utc), "production canary did not start after qualification soak");
  }
  return failures;
}

async function section6MapIssues() {
  const record = await readJson("docs/production-readiness/SECTION6_COVERAGE.json");
  const failures = [];
  const identities = new Set(record.identities.map((item) => item.id));
  const capabilities = new Set(record.capabilities.map((item) => item.id));
  for (const id of ["super_admin", "operator", "guide", "public_customer", "suspended_staff", "cross_tenant_actor"]) {
    if (!identities.has(id)) failures.push(`missing identity ${id}`);
  }
  for (const id of ["onboarding", "auth_recovery", "availability", "walkin_online_booking", "pricing_discounts", "holds_contention", "checkout_webhooks", "invoices_payments", "vouchers", "refunds_weather", "reschedule", "waivers", "arrivals", "reports", "settings_integrations", "messages_marketing", "photos_offline"]) {
    if (!capabilities.has(id)) failures.push(`missing capability ${id}`);
  }
  if (record.continuity.required_accounts !== 100) failures.push("continuity target must remain 100 accounts");
  for (const item of [...record.identities, ...record.capabilities]) {
    if (!Array.isArray(item.evidence) || !item.evidence.length) failures.push(`${item.id}: evidence mapping is missing`);
    for (const file of item.evidence || []) {
      try { await access(path.join(root, file)); } catch { failures.push(`${item.id}: missing ${file}`); }
    }
  }
  return failures;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  const mode = process.argv[2];
  let failures = [];
  if (mode === "--section6-map") failures = await section6MapIssues();
  else if (["--section6-release", "--section9", "--release"].includes(mode)) {
    const manifest = await readJson("docs/production-readiness/RELEASE_MANIFEST.json");
    const packet = await readJson("docs/production-readiness/CLOSEOUT_PACKET.json");
    const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    const candidateCommit = packet.candidate?.admin_commit;
    const checkout = {
      candidateTree: git(["rev-parse", `${candidateCommit}^{tree}`]),
      sourceMatches: sourceMatchesCandidate(root, candidateCommit),
      clean: git(["status", "--porcelain"]) === "",
    };
    const proofIds = mode === "--section9" ? (packet.verdict === "ROLLOUT_READY_500" ? REQUIRED_PROOFS : [])
      : mode === "--section6-release" ? SECTION6_PROOFS : REQUIRED_PROOFS;
    failures = await releaseIssues({ directory: root, manifest, packet, checkout, proofIds, requireClean: mode === "--release" });
    if (mode === "--section6-release") failures.push(...await section6MapIssues());
    if (mode === "--release" && packet.verdict !== "ROLLOUT_READY_500") failures.push("current verdict is not ROLLOUT_READY_500");
    if (mode === "--section9" && packet.verdict === "FAILED_GATE" && !packet.blockers?.length) failures.push("failed-gate handoff needs explicit blockers");
  } else {
    console.error("usage: node scripts/release-evidence-check.mjs --section6-map|--section6-release|--section9|--release");
    process.exit(2);
  }
  if (failures.length) {
    console.error(`FAIL (${failures.length})`);
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log(`PASS ${mode}${mode === "--section9" ? " (handoff only)" : ""}`);
}
