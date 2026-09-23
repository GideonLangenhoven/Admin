import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mixedConfig } from "./bt500-mixed-config.mjs";
import { executionWindow, stopAtWindowEnd } from "../../scripts/bt500-window.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const now = Date.parse("2030-01-01T00:00:00Z");
const config = mixedConfig({
  BT500_MODE: "smoke",
  BT500_RAMP_100: "1s", BT500_RAMP_250: "1s", BT500_RAMP_500: "1s",
  BT500_STEADY: "2s", BT500_SPIKE: "1s", BT500_RECOVERY: "1s",
  BT500_SOAK: "0s", BT500_RAMP_DOWN: "1s",
});
const iso = (time) => new Date(time).toISOString();
const record = (start, end) => ({ starts_at: iso(start), ends_at: iso(end) });

test("requires exact, ordered execution timestamps", () => {
  assert.deepEqual(executionWindow({}, config, now).issues, [
    "execution window start must be an exact UTC ISO timestamp",
    "execution window end must be an exact UTC ISO timestamp",
  ]);
  assert.match(executionWindow({ starts_at: "2026-02-30T00:00:00Z", ends_at: iso(now + 50_000) }, config, now).issues[0], /start must be an exact/);
  assert.match(executionWindow({ starts_at: iso(now - 1_000), ends_at: "2030-01-01" }, config, now).issues[0], /end must be an exact/);
  assert.match(executionWindow(record(now + 1_000, now), config, now).issues[0], /end must be after start/);
});

test("blocks future, expired, and too-short windows; permits an exact fitting window", () => {
  const plannedMs = executionWindow(record(now - 1_000, now + 60_000), config, now).plannedSeconds * 1000;
  assert.equal(plannedMs, 188_000); // Eight stage seconds, 60s setup/teardown, and 30s graceful ramp-down/stop.
  assert.equal(executionWindow(record(now - 1_000, now + 100_000_000), mixedConfig({}), now).plannedSeconds, 92_280);
  assert.match(executionWindow(record(now + 1_000, now + plannedMs + 2_000), config, now).issues[0], /has not opened/);
  assert.match(executionWindow(record(now - plannedMs, now), config, now).issues[0], /has expired/);
  assert.match(executionWindow(record(now - 1_000, now + plannedMs - 1), config, now).issues[0], /insufficient time/);
  assert.deepEqual(executionWindow(record(now - 1_000, now + plannedMs), config, now).issues, []);
});

test("deadline abort kills the active load child without waiting for a long phase", async () => {
  let expired = 0;
  let cancel;
  let timeout;
  const signal = await Promise.race([
    new Promise((resolve) => {
      cancel = stopAtWindowEnd({ kill: resolve }, Date.now() + 15, () => { expired++; });
    }),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("deadline did not stop child")), 500); }),
  ]);
  clearTimeout(timeout);
  cancel();
  assert.equal(signal, "SIGKILL");
  assert.equal(expired, 1);
});

test("deadline rechecks wall-clock time after a forward adjustment", async () => {
  const realNow = Date.now;
  let cancel;
  let timeout;
  try {
    const deadline = Date.now() + 2_000;
    const signal = await Promise.race([
      new Promise((resolve) => {
        cancel = stopAtWindowEnd({ kill: resolve }, deadline, () => {});
        Date.now = () => realNow() + 10_000;
      }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("wall-clock jump was not detected")), 1_500); }),
    ]);
    assert.equal(signal, "SIGKILL");
  } finally {
    Date.now = realNow;
    cancel?.();
    clearTimeout(timeout);
  }
});

test("expired recorded approval cannot reach credentials, k6, or outbound invariants", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bt500-window-"));
  const marker = path.join(dir, "k6-ran");
  writeFileSync(path.join(dir, "k6"), '#!/bin/sh\ntouch "$BT500_TEST_K6_MARKER"\nexit 99\n', { mode: 0o700 });
  try {
    const env = {
      PATH: `${dir}:${process.env.PATH}`,
      BT500_MODE: "smoke",
      BT500_ADMIN_BASE: "https://caepweb-admin.vercel.app",
      BT500_RUN_ID: "synthetic-window-probe",
      BT500_ALLOW_LOAD: "YES",
      BT500_ALLOW_SHARED_PROJECT: "YES",
      BT500_CREDENTIALS_FILE: path.join(dir, "missing-credentials.json"),
      BT500_TEST_K6_MARKER: marker,
    };
    const dry = spawnSync(process.execPath, ["scripts/bt500-run-mixed.mjs", "--dry-run"], { cwd: root, env, encoding: "utf8", timeout: 5_000 });
    assert.equal(dry.status, 0, dry.stderr);
    const plan = JSON.parse(dry.stdout.slice(dry.stdout.indexOf("{")));
    assert.equal(plan.executable, false);
    assert(plan.blockers.includes("execution window has expired"));
    const override = spawnSync(process.execPath, ["scripts/bt500-run-mixed.mjs", "--dry-run"], {
      cwd: root, env: { ...env, K6_SETUP_TIMEOUT: "2h" }, encoding: "utf8", timeout: 5_000,
    });
    assert.equal(override.status, 0, override.stderr);
    assert(JSON.parse(override.stdout.slice(override.stdout.indexOf("{"))).blockers.includes("K6_* option overrides are forbidden for the frozen runner"));
    const run = spawnSync(process.execPath, ["scripts/bt500-run-mixed.mjs", "--run"], { cwd: root, env, encoding: "utf8", timeout: 5_000 });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /execution window has expired/);
    assert.doesNotMatch(run.stderr, /ENOENT|missing-credentials/);
    assert.equal(existsSync(marker), false);
    const preflight = spawnSync(process.execPath, ["scripts/bt500-preflight.mjs", "--execute"], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 5_000 });
    assert.notEqual(preflight.status, 0);
    assert.match(preflight.stderr, /execution window has expired/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("forced expiry and ordinary interruption preserve post-stop invariant evidence", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bt500-window-runner-"));
  let signalRunner;
  try {
    for (const name of ["scripts", "tests/stress", "docs/production-readiness", "bin", "evidence"]) {
      mkdirSync(path.join(dir, name), { recursive: true });
    }
    for (const name of [
      "scripts/bt500-run-mixed.mjs", "scripts/bt500-preflight.mjs", "scripts/bt500-window.mjs",
      "tests/stress/bt500-mixed-config.mjs", "docs/production-readiness/WORKLOAD.json",
    ]) copyFileSync(path.join(root, name), path.join(dir, name));
    const execution = JSON.parse(readFileSync(path.join(root, "docs/production-readiness/BT500_EXECUTION.json"), "utf8"));
    const start = Date.now();
    execution.window = record(start - 1_000, start + 198_000);
    writeFileSync(path.join(dir, "docs/production-readiness/BT500_EXECUTION.json"), JSON.stringify(execution));
    const credentialsFile = path.join(dir, "credentials.json");
    writeFileSync(credentialsFile, JSON.stringify({
      marker: "bt500-20260921",
      url: "https://ukdsrndqhsatjkmxijuj.supabase.co",
      credentials: Array.from({ length: 500 }, () => ({})),
    }), { mode: 0o600 });
    writeFileSync(path.join(dir, "bin/k6"), '#!/bin/sh\ntouch "$BT500_TEST_K6_MARKER"\nexec sleep 5\n', { mode: 0o700 });
    writeFileSync(path.join(dir, "bin/psql"), '#!/bin/sh\ntouch "$BT500_TEST_PSQL_MARKER"\nprintf "synthetic invariant passed\\n"\n', { mode: 0o700 });
    const clockShim = path.join(dir, "clock-shim.mjs");
    writeFileSync(clockShim, `import { existsSync } from "node:fs";
    if (process.argv[1]?.endsWith("bt500-run-mixed.mjs")) {
      const realNow = Date.now;
      const realTimeout = globalThis.setTimeout;
      let jumped = false;
      Date.now = () => realNow() + (jumped ? 300_000 : 0);
      globalThis.setTimeout = (fn, ms, ...args) => !jumped && ms === 1_000
        ? realTimeout(function afterLoadStarts() {
          if (!existsSync(process.env.BT500_TEST_K6_MARKER)) return realTimeout(afterLoadStarts, 10);
          jumped = true;
          fn(...args);
        }, 10)
        : realTimeout(fn, ms, ...args);
      globalThis.fetch = () => { throw new Error("outbound fetch is blocked in this test"); };
    }\n`);
    const k6Marker = path.join(dir, "k6-ran");
    const psqlMarker = path.join(dir, "psql-ran");
    const env = {
      PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
      NODE_OPTIONS: `--import=${clockShim}`,
      BT500_MODE: "smoke",
      BT500_RAMP_100: "1s", BT500_RAMP_250: "1s", BT500_RAMP_500: "1s",
      BT500_STEADY: "2s", BT500_SPIKE: "1s", BT500_RECOVERY: "1s",
      BT500_SOAK: "0s", BT500_RAMP_DOWN: "1s",
      BT500_ADMIN_BASE: execution.environment.admin_url,
      BT500_RUN_ID: "synthetic-expiry",
      BT500_ALLOW_LOAD: "YES",
      BT500_ALLOW_SHARED_PROJECT: "YES",
      BT500_CREDENTIALS_FILE: credentialsFile,
      BT500_EVIDENCE_DIR: path.join(dir, "evidence"),
      BT500_TEST_K6_MARKER: k6Marker,
      BT500_TEST_PSQL_MARKER: psqlMarker,
      DATABASE_URL: "postgresql://synthetic:synthetic@db.ukdsrndqhsatjkmxijuj.supabase.co/postgres",
    };
    const run = spawnSync(process.execPath, ["scripts/bt500-run-mixed.mjs", "--run"], {
      cwd: dir, env, encoding: "utf8", timeout: 5_000,
    });
    assert.equal(run.status, 1, run.stderr);
    assert.equal(existsSync(k6Marker), true, run.stderr + run.stdout);
    assert.equal(existsSync(psqlMarker), true, run.stderr + run.stdout);
    const result = JSON.parse(readFileSync(path.join(dir, "evidence/result.json"), "utf8"));
    assert.equal(result.status, "BT500_MIXED_STAFF_FAIL");
    assert.equal(result.load_exit_code, 1);
    assert.match(result.load_error, /execution window expired; load process terminated/);
    assert.equal(result.invariant_exit_code, 0);
    assert.match(readFileSync(path.join(dir, "evidence/invariants.log"), "utf8"), /synthetic invariant passed/);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "evidence/k6-options.json"), "utf8")), {});

    const signalK6Marker = path.join(dir, "signal-k6-ran");
    const signalPsqlMarker = path.join(dir, "signal-psql-ran");
    const signalEvidenceDir = path.join(dir, "signal-evidence");
    const signalEnv = {
      ...env,
      NODE_OPTIONS: "",
      BT500_RUN_ID: "synthetic-signal",
      BT500_EVIDENCE_DIR: signalEvidenceDir,
      BT500_TEST_K6_MARKER: signalK6Marker,
      BT500_TEST_PSQL_MARKER: signalPsqlMarker,
    };
    signalRunner = spawn(process.execPath, ["scripts/bt500-run-mixed.mjs", "--run"], {
      cwd: dir, env: signalEnv, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [signalRunner.stdout, signalRunner.stderr]) stream.on("data", chunk => { output += chunk; });
    const close = new Promise(resolve => signalRunner.once("close", (code, signal) => resolve({ code, signal })));
    await new Promise((resolve, reject) => {
      const started = Date.now();
      function check() {
        if (existsSync(signalK6Marker)) return resolve();
        if (Date.now() - started > 2_000) return reject(new Error("fake load did not start: " + output));
        setTimeout(check, 10);
      }
      check();
    });
    signalRunner.kill("SIGTERM");
    let signalTimeout;
    const stopped = await Promise.race([
      close,
      new Promise((_, reject) => { signalTimeout = setTimeout(() => reject(new Error("runner did not finish after SIGTERM")), 2_000); }),
    ]);
    clearTimeout(signalTimeout);
    assert.deepEqual(stopped, { code: 1, signal: null }, output);
    assert.equal(existsSync(signalPsqlMarker), true, output);
    const signalResult = JSON.parse(readFileSync(path.join(signalEvidenceDir, "result.json"), "utf8"));
    assert.equal(signalResult.status, "BT500_MIXED_STAFF_FAIL");
    assert.equal(signalResult.load_exit_code, 1);
    assert.match(signalResult.load_error, /runner interrupted by SIGTERM/);
    assert.equal(signalResult.invariant_exit_code, 0);
  } finally {
    signalRunner?.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
