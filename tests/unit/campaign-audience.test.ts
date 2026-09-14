import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";
import { fetchAllRowsResult } from "../../supabase/functions/_shared/pagination";

function campaignFixture(failAt: "audience" | "queue" | "ready" | null = null) {
  const contacts = Array.from({ length: 2101 }, (_, n) => ({ id: String(n), email: `guest${n}@fixture.invalid`, first_name: "Guest" }));
  const queued: any[] = [];
  const campaign: any = {};
  const queries: any[] = [];
  const notify = vi.fn();
  const invoke = vi.fn();
  let inserts = 0;
  const supabase = {
    functions: { invoke },
    from(table: string) {
      const calls: any[] = [];
      let patch: any, insertion: any;
      const execute = async () => {
        queries.push({ table, calls });
        if (table === "marketing_contacts") {
          expect(calls).toContainEqual(["eq", "business_id", "operator-a"]);
          expect(calls).toContainEqual(["eq", "status", "active"]);
          expect(calls).toContainEqual(["overlaps", "tags", ["regular"]]);
          expect(calls).toContainEqual(["order", "id"]);
          const [, from, to] = calls.find(c => c[0] === "range");
          return failAt === "audience" && from > 0 ? { data: null, error: { message: "Offline" } } : { data: contacts.slice(from, to + 1), error: null };
        }
        if (table === "marketing_queue") {
          expect(campaign.status).toBe("draft");
          expect(insertion.length).toBeLessThanOrEqual(500);
          if (failAt === "queue" && ++inserts === 2) return { data: null, error: { message: "Write failed" } };
          queued.push(...insertion);
          return { data: null, error: null };
        }
        if (insertion) Object.assign(campaign, insertion, { id: "campaign-a" });
        if (patch) {
          expect(calls).toContainEqual(["eq", "business_id", "operator-a"]);
          if (failAt === "ready" && patch.status === "scheduled") return { data: null, error: { message: "Write failed" } };
          Object.assign(campaign, patch);
        }
        return { data: { ...campaign }, error: null };
      };
      const q: any = { then: (yes: any, no: any) => execute().then(yes, no), single: execute };
      for (const method of ["select", "eq", "order", "range", "overlaps"]) q[method] = (...args: any[]) => { calls.push([method, ...args]); return q; };
      q.insert = (value: any) => { insertion = value; return q; };
      q.update = (value: any) => { patch = value; return q; };
      return q;
    },
  };
  const setSendingInProgress = vi.fn();
  const send = sourceFunction("app/marketing/templates/page.tsx", "sendCampaign", {
    supabase, fetchAllRowsResult, notify, businessId: "operator-a", sending: { id: "template-a", subject_line: "Hello" }, sendingInProgress: false,
    sendForm: { name: "Fixture", subject: "Hello", scheduledAt: "2027-01-01T10:00:00Z", audienceFilter: "tagged", selectedTags: ["regular"] },
    setSendingInProgress, setSending: vi.fn(), setSendForm: vi.fn(),
  });
  return { send, campaign, queued, queries, notify, invoke, setSendingInProgress };
}

describe("complete campaign audience", () => {
  it("queues all 2,101 matching contacts before making the campaign eligible", async () => {
    const f = campaignFixture();
    await f.send();
    expect(f.queued).toHaveLength(2101);
    expect(new Set(f.queued.map(row => row.contact_id)).size).toBe(2101);
    expect(f.campaign).toMatchObject({ status: "scheduled", total_recipients: 2101 });
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.setSendingInProgress).toHaveBeenLastCalledWith(false);
  });

  it.each(["audience", "queue", "ready"] as const)("a %s failure cannot publish a partial audience", async failure => {
    const f = campaignFixture(failure);
    await f.send();
    expect(["sending", "scheduled"]).not.toContain(f.campaign.status);
    expect(f.notify).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "error" }));
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.setSendingInProgress).toHaveBeenLastCalledWith(false);
  });
});
