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
    "x-tenant-business-id": credential.business_id
  };
  const base = `${input.url}/rest/v1`;
  const started = Date.now();
  const responses = http.batch([
    ["GET", `${base}/admin_users?select=id,role,business_id&user_id=eq.${credential.user_id}`, null, { headers, tags: { journey: "identity" } }],
    ["GET", `${base}/businesses?select=id,name,subscription_status&id=eq.${credential.business_id}`, null, { headers, tags: { journey: "business" } }],
    ["GET", `${base}/bookings?select=id,status,total_amount,created_at&business_id=eq.${credential.business_id}&order=created_at.desc&limit=25`, null, { headers, tags: { journey: "bookings" } }],
    ["GET", `${base}/slots?select=id,start_time,booked,held,capacity_total,status&business_id=eq.${credential.business_id}&order=start_time.asc&limit=25`, null, { headers, tags: { journey: "slots" } }]
  ]);
  check(responses, {
    "all reads succeed": results => results.every(response => response.status === 200),
    "identity visible": results => JSON.parse(results[0].body).length === 1,
    "own business visible": results => JSON.parse(results[1].body).length === 1
  });
  actionDuration.add(Date.now() - started);
  completedActions.add(1);
  sleep(10);
}
