import { durationSeconds, k6Options } from "../tests/stress/bt500-mixed-config.mjs";

function exactUtcMillis(value) {
  const match = typeof value === "string"
    ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/.exec(value)
    : null;
  if (!match) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === `${match[1]}.${match[2] || "000"}Z`
    ? time : NaN;
}

export function executionWindow(window, config, nowMs = Date.now()) {
  const startsAtMs = exactUtcMillis(window?.starts_at);
  const endsAtMs = exactUtcMillis(window?.ends_at);
  const options = k6Options(config);
  const scenario = options.scenarios.bt500_staff;
  const plannedSeconds = config.stages.reduce((sum, stage) => sum + durationSeconds(stage.duration, "stage duration"), 0)
    + durationSeconds(scenario.startTime || "0s", "scenario start")
    + durationSeconds(options.setupTimeout || "60s", "setup timeout")
    + durationSeconds(scenario.gracefulRampDown || "30s", "graceful ramp-down")
    + durationSeconds(scenario.gracefulStop || "30s", "graceful stop")
    + durationSeconds(options.teardownTimeout || "60s", "teardown timeout");
  const issues = [];
  if (!Number.isFinite(startsAtMs)) issues.push("execution window start must be an exact UTC ISO timestamp");
  if (!Number.isFinite(endsAtMs)) issues.push("execution window end must be an exact UTC ISO timestamp");
  if (Number.isFinite(startsAtMs) && Number.isFinite(endsAtMs)) {
    if (endsAtMs <= startsAtMs) issues.push("execution window end must be after start");
    else if (nowMs < startsAtMs) issues.push("execution window has not opened");
    else if (nowMs >= endsAtMs) issues.push("execution window has expired");
    else if (endsAtMs - nowMs < plannedSeconds * 1000) {
      issues.push("execution window has insufficient time for planned load and k6 lifecycle limits");
    }
  }
  return { startsAtMs, endsAtMs, plannedSeconds, issues };
}

export function stopAtWindowEnd(child, endsAtMs, onExpire) {
  let timer;
  let cancelled = false;
  function check() {
    if (cancelled) return;
    const remaining = endsAtMs - Date.now();
    if (remaining <= 0) {
      onExpire();
      child.kill("SIGKILL");
    } else {
      timer = setTimeout(check, Math.min(remaining, 1_000));
    }
  }
  check();
  return () => { cancelled = true; clearTimeout(timer); };
}
