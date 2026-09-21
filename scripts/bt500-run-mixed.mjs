import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mixedConfig } from "../tests/stress/bt500-mixed-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const execution = JSON.parse(await readFile(path.join(root, "docs/production-readiness/BT500_EXECUTION.json"), "utf8"));
const config = mixedConfig(process.env);
const dryRun = process.argv.includes("--dry-run");
const run = process.argv.includes("--run");
if (!dryRun && !run) throw new Error("Use --dry-run or --run");

const contract = spawnSync(process.execPath, ["scripts/bt500-preflight.mjs", "--contract"], { cwd: root, stdio: "inherit" });
if (contract.status !== 0) process.exit(contract.status || 1);

const adminBase = String(process.env.BT500_ADMIN_BASE || "").replace(/\/$/, "");
const runId = String(process.env.BT500_RUN_ID || "");
const blockers = [];
if (execution.status !== "APPROVED_FOR_QUALIFICATION") blockers.push("BT500_EXECUTION.status must be APPROVED_FOR_QUALIFICATION");
if (execution.candidate_worktree_clean !== true) blockers.push("candidate worktree must be recorded clean");
if (!/^[0-9a-f]{40}$/.test(execution.candidate_commit || "") || !/^[0-9a-f]{40}$/.test(execution.candidate_tree || "")) blockers.push("exact candidate commit and tree are required");
if (execution.environment?.classification !== "isolated_non_production"
    && !(execution.environment?.classification === "user_authorized_prelaunch_no_customers"
      && execution.approval?.reference === "user-session-2026-09-21-prelaunch-qualification")) {
  blockers.push("target must be isolated non-production or the recorded no-customer pre-launch project");
}
if (!adminBase) blockers.push("BT500_ADMIN_BASE is required");
else {
  if (!adminBase.startsWith("https://")) blockers.push("BT500_ADMIN_BASE must use HTTPS");
  if (["https://admin.bookingtours.co.za", "https://booking.bookingtours.co.za", "https://onboarding.bookingtours.co.za"].includes(adminBase)) blockers.push("production application hosts are forbidden");
  if (execution.environment?.admin_url !== adminBase) blockers.push("BT500_ADMIN_BASE must equal the frozen execution admin_url");
}
for (const field of ["workload_and_thresholds", "metric_definitions", "realtime_scope", "cost_environment_and_window"]) {
  if (execution.approval?.[field] !== true) blockers.push(`execution approval ${field} is required`);
}
if (execution.outbound_controls?.live_messages_blocked !== true || execution.outbound_controls?.live_payments_blocked !== true) blockers.push("live messages and payments must be blocked");
if (process.env.BT500_ALLOW_LOAD !== "YES") blockers.push("BT500_ALLOW_LOAD=YES is required");
if (process.env.BT500_ALLOW_SHARED_PROJECT !== "YES") blockers.push("BT500_ALLOW_SHARED_PROJECT=YES is required");
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(runId)) blockers.push("BT500_RUN_ID must be 1-48 safe characters");

const plan = {
  status: "BT500_MIXED_CONFIG_VALID",
  profile_id: "BT500-LAUNCH-V1",
  mode: config.mode,
  sessions: 500,
  businesses: 167,
  action_mix: { reads: 0.7, legitimate_writes: 0.2, other_authenticated_workflows: 0.1 },
  stages: config.stages,
  cadence_seconds: { normal: 10, spike: 5 },
  thresholds: {
    read_ms: { p95: 750, p99: 1500 },
    write_ms: { p95: 1500, p99: 3000 },
    unexpected_failure_rate_lt: 0.001,
    dropped_iterations: 0,
    invariant_violations: 0,
  },
  executable: blockers.length === 0,
  blockers,
  separate_gates: ["public checkout", "webhook/provider doubles", "Realtime browser footprint", "genuine provider journeys"],
};

if (dryRun) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
if (blockers.length) throw new Error("BT500 mixed run blocked:\n- " + blockers.join("\n- "));

const credentialsFile = process.env.BT500_CREDENTIALS_FILE || "/private/tmp/bt500-credentials.json";
const credentials = JSON.parse(await readFile(credentialsFile, "utf8"));
const projectRef = execution.environment.supabase_project_ref;
if (credentials.marker !== "bt500-20260921") throw new Error("unexpected credential marker");
if (new URL(credentials.url).host !== `${projectRef}.supabase.co`) throw new Error("credential project does not match execution project");
if (credentials.credentials?.length !== 500) throw new Error("exactly 500 credentials are required");
if ((await stat(credentialsFile)).mode & 0o077) throw new Error("credential file must not be readable by group or others");

const databaseUrl = new URL(process.env.DATABASE_URL || "postgresql://missing");
const directHost = databaseUrl.hostname === `db.${projectRef}.supabase.co`;
const pooledUser = decodeURIComponent(databaseUrl.username).endsWith(`.${projectRef}`);
if (!directHost && !pooledUser) throw new Error("DATABASE_URL does not match the execution project");

const evidenceDir = path.resolve(process.env.BT500_EVIDENCE_DIR || `/private/tmp/bt500-mixed-${runId}`);
await mkdir(evidenceDir, { recursive: true });

async function logged(program, args, logName, env = process.env) {
  const log = createWriteStream(path.join(evidenceDir, logName), { flags: "w", mode: 0o600 });
  const child = spawn(program, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) {
    stream.pipe(log, { end: false });
    stream.pipe(stream === child.stdout ? process.stdout : process.stderr);
  }
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  log.end();
  return code;
}

const k6Args = [
  "run",
  "--summary-export", path.join(evidenceDir, "k6-summary.json"),
  "-e", `BT500_CREDENTIALS_FILE=${credentialsFile}`,
  "-e", `BT500_ADMIN_BASE=${adminBase}`,
  "-e", `BT500_RUN_ID=${runId}`,
  "-e", `BT500_MODE=${config.mode}`,
  "-e", "BT500_ALLOW_LOAD=YES",
  "-e", "BT500_ALLOW_SHARED_PROJECT=YES",
  ...Object.entries({
    BT500_RAMP_100: config.values.ramp100,
    BT500_RAMP_250: config.values.ramp250,
    BT500_RAMP_500: config.values.ramp500,
    BT500_STEADY: config.values.steady,
    BT500_SPIKE: config.values.spike,
    BT500_RECOVERY: config.values.recovery,
    BT500_SOAK: config.values.soak,
    BT500_RAMP_DOWN: config.values.rampDown,
  }).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
  "tests/stress/bt500-mixed.k6.js",
];

let loadCode = 1;
let loadError = null;
try {
  loadCode = await logged("k6", k6Args, "k6.log");
} catch (error) {
  loadError = String(error?.message || error);
}

const psqlEnv = {
  ...process.env,
  PGHOST: databaseUrl.hostname,
  PGPORT: databaseUrl.port || "5432",
  PGUSER: decodeURIComponent(databaseUrl.username),
  PGPASSWORD: decodeURIComponent(databaseUrl.password),
  PGDATABASE: databaseUrl.pathname.slice(1) || "postgres",
  PGSSLMODE: databaseUrl.searchParams.get("sslmode") || "require",
};
let invariantCode = 1;
let invariantError = null;
try {
  invariantCode = await logged("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", "tests/stress/bt500-invariants.sql"], "invariants.log", psqlEnv);
} catch (error) {
  invariantError = String(error?.message || error);
}

const result = {
  ...plan,
  status: loadCode === 0 && invariantCode === 0 ? "BT500_MIXED_STAFF_PASS" : "BT500_MIXED_STAFF_FAIL",
  run_id: runId,
  evidence_dir: evidenceDir,
  load_exit_code: loadCode,
  invariant_exit_code: invariantCode,
  load_error: loadError,
  invariant_error: invariantError,
  mixed_runner_complete: false,
};
await writeFile(path.join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(result));
if (loadCode !== 0 || invariantCode !== 0) process.exit(1);
