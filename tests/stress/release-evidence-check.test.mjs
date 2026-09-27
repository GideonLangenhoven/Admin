import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { releaseIssues, REQUIRED_PROOFS } from "../../scripts/release-evidence-check.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");

test("release proof rejects stale candidate, missing/failed result, and tampered artifact", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "release-evidence-"));
  try {
    mkdirSync(path.join(directory, "docs/production-readiness/evidence"), { recursive: true });
    writeFileSync(path.join(directory, "package-lock.json"), "fixture-lock");
    const candidate = {
      admin_commit: "a".repeat(40), admin_tree: "b".repeat(40), admin_lock_sha256: sha("fixture-lock"),
      booking_commit: "c".repeat(40), booking_tree: "d".repeat(40), booking_lock_sha256: "e".repeat(64),
      onboarding_commit: "f".repeat(40), onboarding_tree: "1".repeat(40), onboarding_lock_sha256: "2".repeat(64),
      supabase_project: "synthetic-project", profile_id: "BT500-LAUNCH-V1",
    };
    const deployment_ids = { admin: "dpl_admin", booking: "dpl_booking", onboarding: "dpl_onboarding" };
    const source_ci = { admin_commit: candidate.admin_commit, run_id: 123, conclusion: "SUCCESS", url: "https://github.com/example/admin/actions/runs/123" };
    const manifest = { current_candidate: { ...candidate, source_ci }, planned_unapplied_migrations: ["supabase/migrations/20300101000000_fixture.sql"] };
    const packet = { schema_version: 1, verdict: "ROLLOUT_READY_500", candidate, source_ci, deployment_ids, config_fingerprint: "3".repeat(64), migration_versions: ["20300101000000"], proofs: {} };
    const checkout = { candidateTree: candidate.admin_tree, sourceMatches: true, clean: true };
    for (const id of REQUIRED_PROOFS) {
      const file = `docs/production-readiness/evidence/${id}.json`;
      const rawFile = `docs/production-readiness/evidence/${id}-machine.json`;
      const started_at_utc = id === "production_canary" ? "2026-09-21T00:00:00Z" : "2026-09-20T00:00:00Z";
      const ended_at_utc = id === "production_canary" ? "2026-09-22T00:00:00Z" : "2026-09-21T00:00:00Z";
      const raw = {
        id, status: "PASS", exit_code: 0, candidate, deployment_ids, config_fingerprint: packet.config_fingerprint,
        started_at_utc, ended_at_utc,
        unresolved_high_critical: 0, security_checks_passed: true, reconciliation_passed: true, rollback_plan_checked: true, migration_versions: packet.migration_versions,
        source_commits: { admin: candidate.admin_commit, booking: candidate.booking_commit, onboarding: candidate.onboarding_commit }, edge_function_count: 55,
        shared_limiter_ready: true, trusted_recovery_origin: true, bypass_disabled: true, secrets_redacted: true,
        completed_accounts: 100, identity_links_preserved: true, pending_work_reconciled: true, role_matrix_passed: true, cross_tenant_denials_passed: true, suspended_denials_passed: true,
        genuine_sandbox_completed: true, simulated: false, yoco_payment_webhook_refund: true, email_received: true, whatsapp_received: true,
        contention_passed: true, invariant_violations: 0, unknown_outcomes_reconciled: true,
        non_marker_rejected: true, unapproved_recipient_rejected: true, live_payment_rejected: true, missing_double_rejected: true, unsafe_teardown_rejected: true,
        provider_doubles_enabled: true, public_actions_per_second: 5, checkout_per_second: 0.5, webhook_per_second: 1.25, transactional_jobs_completed: 500, transactional_burst_seconds: 600, marketing_active: true,
        bookings: 250000, slots: 62500, customer_relationships: 25000, message_audit_rows: 500000, busy_tenant_bookings: 25000, sustained_headroom_fraction: 0.3, incremental_cost_zar: 0,
        browser_connections: 500, shell_bindings: 1000, update_p95_ms: 2000, unrecovered_disconnects: 0,
        mode: "qualification", duration_seconds: 86400, active_sessions: 500, unique_staff_accounts: 500, steady_staff_actions_per_second: 50, staff_action_mix: { read: 0.7, write: 0.2, other: 0.1 }, read_p95_ms: 750, read_p99_ms: 1500, write_p95_ms: 1500, write_p99_ms: 3000, valid_failure_rate: 0, dropped_iterations: 0, thresholds_passed: true, load_exit_code: 0, invariant_exit_code: 0, mixed_runner_complete: true,
        spike_rate_multiplier: 2, spike_seconds: 300, recovery_seconds: 600, lost_or_duplicate_financial_work: 0, continuous: true, growing_resource_leak: false,
        alert_received: true, owner_acknowledged: true, missed_scheduler_covered: true, aged_jobs_covered: true,
        restore_target: "separate-synthetic-project", rpo_seconds: 900, rto_seconds: 3600, database_restored: true, auth_restored: true, private_files_restored: true, protected_config_restored: true,
        cohort_steps: [5, 25, 100, 250, 500], scheduled_jobs_exercised: true, health_gates_passed: true,
      };
      const rawBody = JSON.stringify(raw);
      writeFileSync(path.join(directory, rawFile), rawBody);
      const body = JSON.stringify({ id, status: "PASS", exit_code: 0, run_id: `fixture-${id}`, source: "offline fixture", observed_at_utc: "2026-09-23T00:00:00Z", candidate, deployment_ids, config_fingerprint: packet.config_fingerprint, raw_artifacts: [{ file: rawFile, sha256: sha(rawBody), kind: "machine_result" }] });
      writeFileSync(path.join(directory, file), body);
      packet.proofs[id] = { file, sha256: sha(body) };
    }
    const issues = () => releaseIssues({ directory, manifest, packet, checkout });
    assert.deepEqual(await issues(), []);
    const ciUrl = packet.source_ci.url;
    packet.source_ci.url = "https://github.com/example/admin/actions/runs/999";
    assert((await issues()).some((item) => item.includes("mismatched")));
    packet.source_ci.url = ciUrl;
    checkout.sourceMatches = false;
    assert((await issues()).some((item) => item.includes("source or harness differs")));
    checkout.sourceMatches = true;
    delete packet.proofs.bt500_mixed_60m;
    assert((await issues()).some((item) => item.includes("bt500_mixed_60m: retained result is missing")));
    const id = "bt500_mixed_60m";
    const file = `docs/production-readiness/evidence/${id}.json`;
    const failed = JSON.parse(readFileSync(path.join(directory, file), "utf8"));
    failed.status = "FAIL";
    const failedBody = JSON.stringify(failed);
    writeFileSync(path.join(directory, file), failedBody);
    packet.proofs[id] = { file, sha256: sha(failedBody) };
    assert((await issues()).some((item) => item.includes(`${id}: result is not PASS`)));
    failed.status = "PASS";
    packet.proofs[id].sha256 = sha(JSON.stringify(failed));
    assert((await issues()).some((item) => item.includes(`${id}: artifact hash differs`)));
    writeFileSync(path.join(directory, file), JSON.stringify(failed));
    failed.observed_at_utc = "2030-01-01T00:00:00Z";
    writeFileSync(path.join(directory, file), JSON.stringify(failed));
    packet.proofs[id].sha256 = sha(JSON.stringify(failed));
    assert((await issues()).some((item) => item.includes(`${id}: UTC observation time is missing or in the future`)));
    failed.observed_at_utc = "2026-09-23T00:00:00Z";
    writeFileSync(path.join(directory, file), JSON.stringify(failed));
    packet.proofs[id].sha256 = sha(JSON.stringify(failed));
    const rawFile = `docs/production-readiness/evidence/${id}-machine.json`;
    const raw = JSON.parse(readFileSync(path.join(directory, rawFile), "utf8"));
    raw.status = "FAIL";
    raw.exit_code = 1;
    writeFileSync(path.join(directory, rawFile), JSON.stringify(raw));
    failed.raw_artifacts[0].sha256 = sha(JSON.stringify(raw));
    writeFileSync(path.join(directory, file), JSON.stringify(failed));
    packet.proofs[id].sha256 = sha(JSON.stringify(failed));
    assert((await issues()).some((item) => item.includes(`${id}: machine result status/exit failed`)));
    raw.status = "PASS";
    raw.exit_code = 0;
    raw.read_p95_ms = null;
    writeFileSync(path.join(directory, rawFile), JSON.stringify(raw));
    failed.raw_artifacts[0].sha256 = sha(JSON.stringify(raw));
    writeFileSync(path.join(directory, file), JSON.stringify(failed));
    packet.proofs[id].sha256 = sha(JSON.stringify(failed));
    assert((await issues()).some((item) => item.includes(`${id}: machine result required measurements`)));
    raw.read_p95_ms = 750;
    raw.started_at_utc = "2030-01-01T00:00:00Z";
    raw.ended_at_utc = "2030-01-02T00:00:00Z";
    writeFileSync(path.join(directory, rawFile), JSON.stringify(raw));
    failed.raw_artifacts[0].sha256 = sha(JSON.stringify(raw));
    writeFileSync(path.join(directory, file), JSON.stringify(failed));
    packet.proofs[id].sha256 = sha(JSON.stringify(failed));
    assert((await issues()).some((item) => item.includes(`${id}: machine result UTC interval/duration`)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
