import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const input = JSON.parse(open(__ENV.CREDENTIALS_FILE || "/private/tmp/bt500-credentials.json"));
if (input.credentials?.length !== 500) throw new Error("exactly 500 credentials are required");
const actionDuration = new Trend("bt500_action_duration", true);
const completedActions = new Counter("bt500_completed_actions");

export const options = {
  scenarios: {
    bt500: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP_100 || "30s", target: 100 },
        { duration: __ENV.RAMP_250 || "30s", target: 250 },
        { duration: __ENV.RAMP_500 || "30s", target: 500 },
        { duration: __ENV.STEADY || "5m", target: 500 },
        { duration: __ENV.RAMP_DOWN || "30s", target: 0 }
      ],
      gracefulRampDown: "30s"
    }
  },
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate<0.001"],
    http_req_duration: ["p(95)<750", "p(99)<1500"],
    bt500_action_duration: ["p(95)<1500", "p(99)<3000"],
    dropped_iterations: ["count==0"]
  }
};

export default function () {
  const credential = input.credentials[(__VU - 1) % input.credentials.length];
  const headers = {
    apikey: input.anon_key,
    Authorization: `Bearer ${credential.access_token}`,
    "x-tenant-business-id": credential.business_id,
    "Content-Type": "application/json"
  };
  const base = `${input.url}/rest/v1`;
  const started = Date.now();
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow); dayAfter.setDate(dayAfter.getDate() + 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const response = http.post(`${base}/rpc/get_operator_dashboard`, JSON.stringify({
    p_business_id: credential.business_id,
    p_today_start: today.toISOString(),
    p_tomorrow_start: tomorrow.toISOString(),
    p_day_after: dayAfter.toISOString(),
    p_week_ago: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    p_month_start: monthStart.toISOString(),
    p_now: now.toISOString()
  }), { headers, tags: { journey: "dashboard_snapshot" } });
  check(response, {
    "dashboard snapshot succeeds": result => result.status === 200,
    "own business visible": result => JSON.parse(result.body).business_id === credential.business_id
  });
  actionDuration.add(Date.now() - started);
  completedActions.add(1);
  sleep(10);
}
