import { execSync } from "node:child_process";

function getPortPids(port) {
  try {
    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { encoding: "utf8" }).trim();
    if (!output) return [];
    return output.split("\n").map((value) => Number(value)).filter((value) => Number.isFinite(value));
  } catch {
    return [];
  }
}

const targetPort = 3000;
const initialPids = getPortPids(targetPort);

const killResults = [];
for (const pid of initialPids) {
  try {
    process.kill(pid, "SIGKILL");
    killResults.push({ pid, killed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    killResults.push({ pid, killed: false, error: message });
  }
}

const remainingPids = getPortPids(targetPort);
