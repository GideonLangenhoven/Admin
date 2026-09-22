const DEFAULTS = Object.freeze({
  mode: "qualification",
  ramp100: "5m",
  ramp250: "5m",
  ramp500: "5m",
  steady: "60m",
  spike: "5m",
  recovery: "10m",
  soak: "24h",
  rampDown: "5m",
});

const UNITS = Object.freeze({ ms: 0.001, s: 1, m: 60, h: 3600 });

export function durationSeconds(value, label) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(value));
  if (!match) throw new Error(`${label} must be a single k6 duration such as 30s, 60m, or 24h`);
  return Number(match[1]) * UNITS[match[2]];
}

export function mixedConfig(env = {}) {
  const mode = env.BT500_MODE || DEFAULTS.mode;
  if (mode !== "qualification" && mode !== "smoke") {
    throw new Error("BT500_MODE must be qualification or smoke");
  }

  const values = {
    ramp100: env.BT500_RAMP_100 || DEFAULTS.ramp100,
    ramp250: env.BT500_RAMP_250 || DEFAULTS.ramp250,
    ramp500: env.BT500_RAMP_500 || DEFAULTS.ramp500,
    steady: env.BT500_STEADY || DEFAULTS.steady,
    spike: env.BT500_SPIKE || DEFAULTS.spike,
    recovery: env.BT500_RECOVERY || DEFAULTS.recovery,
    soak: env.BT500_SOAK || DEFAULTS.soak,
    rampDown: env.BT500_RAMP_DOWN || DEFAULTS.rampDown,
  };
  const seconds = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, durationSeconds(value, `BT500_${key}`)]));
  for (const phase of ["ramp100", "ramp250", "ramp500", "steady", "spike", "recovery", "rampDown"]) {
    if (seconds[phase] <= 0) throw new Error(`${phase} duration must be greater than zero`);
  }
  if (mode === "qualification") {
    if (seconds.steady < 3600) throw new Error("qualification steady phase must be at least 60m");
    if (seconds.spike < 300) throw new Error("qualification spike phase must be at least 5m");
    if (seconds.recovery < 600) throw new Error("qualification recovery phase must be at least 10m");
    if (seconds.soak < 86400) throw new Error("qualification soak phase must be at least 24h");
  }

  const rampSeconds = seconds.ramp100 + seconds.ramp250 + seconds.ramp500;
  const stages = [
    { duration: values.ramp100, target: 100 },
    { duration: values.ramp250, target: 250 },
    { duration: values.ramp500, target: 500 },
    { duration: values.steady, target: 500 },
    { duration: values.spike, target: 500 },
    { duration: values.recovery, target: 500 },
    ...(seconds.soak > 0 ? [{ duration: values.soak, target: 500 }] : []),
    { duration: values.rampDown, target: 0 },
  ];

  return {
    mode,
    values,
    seconds,
    stages,
    phaseEnds: {
      ramp: rampSeconds,
      steady: rampSeconds + seconds.steady,
      spike: rampSeconds + seconds.steady + seconds.spike,
      recovery: rampSeconds + seconds.steady + seconds.spike + seconds.recovery,
    },
  };
}

export function executionStatusAllows(mode, status) {
  return status === "APPROVED_FOR_QUALIFICATION"
    || (mode === "smoke" && status === "APPROVED_FOR_BOUNDED_SMOKE");
}

export function phaseAt(config, elapsedSeconds) {
  if (elapsedSeconds < config.phaseEnds.ramp) return "ramp";
  if (elapsedSeconds < config.phaseEnds.steady) return "steady";
  if (elapsedSeconds < config.phaseEnds.spike) return "spike";
  if (elapsedSeconds < config.phaseEnds.recovery) return "recovery";
  return config.seconds.soak > 0 && elapsedSeconds < config.phaseEnds.recovery + config.seconds.soak ? "soak" : "ramp_down";
}

export function k6Options(config) {
  const phases = config.mode === "qualification" ? ["steady", "spike", "recovery", "soak"] : [];
  const readJourneys = ["dashboard_snapshot", "arrival_state", "session", "report", "inbox"];
  const readBudget = ["p(95)<=750", "p(99)<=1500"];
  const writeBudget = ["p(95)<=1500", "p(99)<=3000"];
  const thresholds = {
    bt500_read_action_duration: readBudget,
    bt500_write_action_duration: writeBudget,
    bt500_other_action_duration: readBudget,
    bt500_unexpected_failure: ["rate<0.001"],
    bt500_invariant_violations: ["count==0"],
    dropped_iterations: ["count==0"],
  };
  for (const phase of phases) {
    thresholds[`bt500_read_action_duration{phase:${phase},journey:dashboard_bundle}`] = readBudget;
    thresholds[`bt500_write_action_duration{phase:${phase},journey:record_arrival}`] = writeBudget;
    thresholds[`bt500_write_request_duration{phase:${phase},journey:record_arrival}`] = writeBudget;
    for (const journey of ["session", "report", "inbox"]) {
      thresholds[`bt500_other_action_duration{phase:${phase},journey:${journey}}`] = readBudget;
    }
    for (const kind of ["read", "write", "other"]) {
      thresholds[`bt500_unexpected_failure{phase:${phase},kind:${kind}}`] = ["rate<0.001"];
    }
    for (const journey of readJourneys) {
      thresholds[`bt500_read_request_duration{phase:${phase},journey:${journey}}`] = readBudget;
      thresholds[`bt500_journey_failure{phase:${phase},journey:${journey}}`] = ["rate<0.001"];
    }
    thresholds[`bt500_journey_failure{phase:${phase},journey:record_arrival}`] = ["rate<0.001"];
  }
  if (config.mode === "qualification") {
    thresholds["bt500_completed_actions{phase:steady}"] = [`count>=${config.seconds.steady * 50 - 500}`];
    thresholds["bt500_completed_actions{phase:spike}"] = [`count>=${config.seconds.spike * 100 - 500}`];
    thresholds["bt500_completed_actions{phase:recovery}"] = [`count>=${config.seconds.recovery * 50 - 500}`];
  }
  return {
    scenarios: {
      bt500_staff: {
        executor: "ramping-vus",
        startVUs: 0,
        stages: config.stages,
        gracefulRampDown: "30s",
      },
    },
    thresholds,
  };
}
