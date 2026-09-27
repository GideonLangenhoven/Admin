import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export function loadBt500Execution(root, requireExternal = false) {
  const file = process.env.BT500_EXECUTION_FILE;
  if (!file && requireExternal) throw new Error("BT500_EXECUTION_FILE outside the checkout is required for hosted execution");
  if (!file) return JSON.parse(readFileSync(path.join(root, "docs/production-readiness/BT500_EXECUTION.json"), "utf8"));
  if (!path.isAbsolute(file) || realpathSync(file).startsWith(`${realpathSync(root)}${path.sep}`)) throw new Error("BT500_EXECUTION_FILE must be an absolute file outside the checkout");
  const bytes = readFileSync(file);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(process.env.BT500_EXECUTION_SHA256 || "") || digest !== process.env.BT500_EXECUTION_SHA256) throw new Error("BT500 execution packet SHA-256 does not match");
  return JSON.parse(bytes);
}
