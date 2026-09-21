import assert from "node:assert/strict";
import test from "node:test";
import { durationSeconds, k6Options, mixedConfig, phaseAt } from "./bt500-mixed-config.mjs";

test("qualification defaults preserve the frozen BT500 phase contract", () => {
  const config = mixedConfig({});
  assert.equal(config.mode, "qualification");
  assert.deepEqual(config.stages.map(stage => stage.target), [100, 250, 500, 500, 500, 500, 500, 0]);
  assert.equal(config.seconds.steady, 3600);
  assert.equal(config.seconds.spike, 300);
  assert.equal(config.seconds.recovery, 600);
  assert.equal(config.seconds.soak, 86400);
  assert.equal(phaseAt(config, config.phaseEnds.steady), "spike");
  assert.deepEqual(k6Options(config).thresholds.bt500_read_duration, ["p(95)<=750", "p(99)<=1500"]);
  assert.deepEqual(k6Options(config).thresholds.bt500_write_duration, ["p(95)<=1500", "p(99)<=3000"]);
  assert.deepEqual(k6Options(config).thresholds.bt500_unexpected_failure, ["rate<0.001"]);
});

test("qualification mode rejects shortened contract phases", () => {
  assert.throws(() => mixedConfig({ BT500_STEADY: "59m" }), /at least 60m/);
  assert.throws(() => mixedConfig({ BT500_SPIKE: "299s" }), /at least 5m/);
  assert.throws(() => mixedConfig({ BT500_RECOVERY: "599s" }), /at least 10m/);
  assert.throws(() => mixedConfig({ BT500_SOAK: "23h" }), /at least 24h/);
});

test("smoke mode permits short phases and an omitted soak without changing targets", () => {
  const config = mixedConfig({
    BT500_MODE: "smoke",
    BT500_RAMP_100: "1s",
    BT500_RAMP_250: "1s",
    BT500_RAMP_500: "1s",
    BT500_STEADY: "2s",
    BT500_SPIKE: "1s",
    BT500_RECOVERY: "1s",
    BT500_SOAK: "0s",
    BT500_RAMP_DOWN: "1s",
  });
  assert.deepEqual(config.stages.map(stage => stage.target), [100, 250, 500, 500, 500, 500, 0]);
  assert.equal(k6Options(config).thresholds["bt500_completed_actions{phase:steady}"], undefined);
});

test("duration parsing fails closed", () => {
  assert.equal(durationSeconds("1.5m", "duration"), 90);
  assert.throws(() => durationSeconds("one hour", "duration"), /single k6 duration/);
  assert.throws(() => mixedConfig({ BT500_MODE: "preview" }), /qualification or smoke/);
});
