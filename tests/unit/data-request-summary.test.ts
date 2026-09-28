import { expect, it } from "vitest";
import { sourceExports } from "../helpers/source-handler";

it("counts actionable data requests only for the signed-in operator", async () => {
  const calls: unknown[] = [];
  const query = {
    select: (_columns: string, options: unknown) => { calls.push(["select", options]); return query; },
    eq: (column: string, value: string) => { calls.push(["eq", column, value]); return query; },
    in: async (column: string, values: string[]) => { calls.push(["in", column, values]); return { count: 3, error: null }; },
  };
  const { GET: handler } = sourceExports("app/api/admin/data-requests/route.ts", {
    "@/app/lib/api-auth": { getCallerAdmin: async () => ({ business_id: "operator-a" }) },
    "@supabase/supabase-js": { createClient: () => ({ from: (table: string) => { calls.push(["from", table]); return query; } }) },
  }) as { GET: (request: Request) => Promise<Response> };

  const response = await handler(new Request("https://fixture.invalid/api/admin/data-requests?summary=actionable"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ count: 3 });
  expect(calls).toEqual([
    ["from", "data_subject_requests"],
    ["select", { count: "exact", head: true }],
    ["eq", "business_id", "operator-a"],
    ["in", "status", ["CONFIRMED", "IN_REVIEW"]],
  ]);
});
