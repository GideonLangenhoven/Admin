import { spawn } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRef = "ukdsrndqhsatjkmxijuj";
const configUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const managementToken = process.env.SUPABASE_ACCESS_TOKEN;
const credentialsFile = "/private/tmp/bt500-credentials.json";
const evidenceDir = "/private/tmp/bookingtours-simple-view-evidence-1812677/resume-20260921/bt500-read-smoke";
const temporaryLimit = Number(process.env.BT500_SESSION_LIMIT || 800);
if (!managementToken) throw new Error("SUPABASE_ACCESS_TOKEN is required");
if (process.env.BT500_ALLOW_AUTH_LIMIT_CHANGE !== "YES") throw new Error("BT500_ALLOW_AUTH_LIMIT_CHANGE=YES is required");

async function authConfig(method = "GET", body) {
  const response = await fetch(configUrl, {
    method,
    headers: { Authorization: `Bearer ${managementToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Auth config ${method} failed: ${response.status} ${JSON.stringify(result)}`);
  return result;
}

async function command(program, args, env, logName) {
  const logPath = path.join(evidenceDir, logName);
  const child = spawn(program, args, { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { const text = chunk.toString(); log += text; process.stdout.write(text); });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  await writeFile(logPath, log);
  if (code !== 0) throw new Error(`${program} exited ${code}; see ${logPath}`);
}

await mkdir(evidenceDir, { recursive: true });
const initial = await authConfig();
if (initial.rate_limit_verify !== 30) throw new Error(`expected rate_limit_verify=30, found ${initial.rate_limit_verify}`);
let limitRaised = false;
try {
  if (temporaryLimit !== 800) throw new Error("BT500_SESSION_LIMIT must be exactly800 for this approved run");
  const raised = await authConfig("PATCH", { rate_limit_verify: temporaryLimit });
  if (raised.rate_limit_verify !== temporaryLimit) throw new Error(`verification limit did not change to ${temporaryLimit}`);
  limitRaised = true;
  console.log(JSON.stringify({ status: "AUTH_LIMIT_TEMPORARILY_RAISED", from: 30, to: temporaryLimit }));
  await command("node", ["scripts/bt500-seed.mjs", "--sessions"], { BT500_ALLOW_SHARED_PROJECT: "YES" }, "sessions.log");
} finally {
  if (limitRaised) {
    const restored = await authConfig("PATCH", { rate_limit_verify: 30 });
    if (restored.rate_limit_verify !== 30) throw new Error("CRITICAL: verification limit was not restored to 30");
    console.log(JSON.stringify({ status: "AUTH_LIMIT_RESTORED", value: 30 }));
  }
}

let loadError;
try {
  await command("k6", [
    "run",
    "--summary-export", path.join(evidenceDir, "summary.json"),
    "-e", `CREDENTIALS_FILE=${credentialsFile}`,
    "tests/stress/bt500-read-smoke.k6.js"
  ], {}, "k6.log");
} catch (error) {
  loadError = error;
} finally {
  await command("node", ["scripts/bt500-seed.mjs", "--teardown"], { BT500_ALLOW_SHARED_PROJECT: "YES" }, "teardown.log");
  await unlink(credentialsFile).catch(() => {});
}
if (loadError) throw loadError;
console.log(JSON.stringify({ status: "BT500_READ_SMOKE_COMPLETE", evidence: evidenceDir }));
