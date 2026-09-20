import { describe, expect, it, vi } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

type Voucher = {
  id: string;
  business_id: string;
  buyer_name: string;
  buyer_email: string;
  recipient_name: string;
  tour_name: string;
  value: number;
  purchase_amount: number;
  payment_url: string;
  payment_reminder_sent_at: string | null;
  status: string;
  created_at: string;
};

const voucherId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";

function fixture(fetchImpl: typeof fetch, ageMinutes = 20, count = 1) {
  const vouchers: Voucher[] = Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? voucherId : `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
    business_id: businessId,
    buyer_name: "Fixture Buyer",
    buyer_email: "buyer@fixture.invalid",
    recipient_name: "Fixture Guest",
    tour_name: "Fixture Tour",
    value: 500,
    purchase_amount: 500,
    payment_url: "https://pay.fixture.invalid/original",
    payment_reminder_sent_at: null,
    status: "PENDING",
    created_at: new Date(Date.now() - ageMinutes * 60_000).toISOString(),
  }));
  const voucher = vouchers[0];
  let failNextUpdate = false;
  const updates: Array<Record<string, unknown>> = [];
  const deletes: string[] = [];

  const supabase = {
    from(table: string) {
      if (table !== "vouchers") throw new Error("Unexpected table: " + table);
      const predicates: Array<(row: Voucher) => boolean> = [];
      let operation: "select" | "update" | "delete" = "select";
      let patch: Record<string, unknown> = {};
      const execute = async (single = false) => {
        const matching = vouchers.filter((row) => predicates.every((predicate) => predicate(row)));
        if (operation === "update") {
          if (failNextUpdate) {
            failNextUpdate = false;
            return { data: null, error: { message: "fixture stamp unavailable" } };
          }
          matching.forEach((row) => Object.assign(row, patch));
          if (matching.length) updates.push(patch);
        } else if (operation === "delete") {
          matching.forEach((row) => deletes.push(row.id));
        }
        const data = operation === "delete" ? matching.map((row) => ({ id: row.id })) : matching;
        return { data: single ? data[0] || null : data, error: null };
      };
      const query: any = {
        select: () => query,
        eq: (key: keyof Voucher, value: unknown) => { predicates.push((row) => row[key] === value); return query; },
        is: (key: keyof Voucher, value: unknown) => { predicates.push((row) => row[key] === value); return query; },
        not: (key: keyof Voucher, _operator: string, value: unknown) => { predicates.push((row) => row[key] !== value); return query; },
        lt: (key: keyof Voucher, value: string) => { predicates.push((row) => String(row[key]) < value); return query; },
        gt: (key: keyof Voucher, value: string) => { predicates.push((row) => String(row[key]) > value); return query; },
        in: (key: keyof Voucher, values: unknown[]) => { predicates.push((row) => values.includes(row[key])); return query; },
        order: () => query,
        limit: () => query,
        update: (value: Record<string, unknown>) => { operation = "update"; patch = value; return query; },
        delete: () => { operation = "delete"; return query; },
        maybeSingle: () => execute(true),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => execute().then(resolve, reject),
      };
      return query;
    },
  };

  const sharedBindings = {
    AbortSignal,
    Date,
    SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_KEY: "fixture-service-not-real",
    CRON_BATCH_SIZE: 500,
    fetch: fetchImpl,
  };
  const sendInternalEmail = sourceFunction("supabase/functions/cron-tasks/index.ts", "sendInternalEmail", sharedBindings);
  const cleanup = sourceFunction("supabase/functions/cron-tasks/index.ts", "cleanupAbandonedVouchers", {
    ...sharedBindings,
    supabase,
    sendInternalEmail,
  }) as () => Promise<Record<string, number>>;

  return { voucher, vouchers, updates, deletes, cleanup, failNextStamp: () => { failNextUpdate = true; } };
}

describe("voucher payment reminder delivery state", () => {
  for (const status of [401, 429, 500]) {
    it(`does not stamp provider rejection HTTP ${status}`, async () => {
      const f = fixture(vi.fn(async () => Response.json({ ok: false, error: "rejected" }, { status })));
      const result = await f.cleanup();
      expect(f.voucher.payment_reminder_sent_at).toBeNull();
      expect(f.updates).toEqual([]);
      expect(result).toMatchObject({ voucher_reminders_accepted: 0, voucher_reminder_failures: 1 });
    });
  }

  it("does not stamp a resolved 200 response whose body says the send failed", async () => {
    const f = fixture(vi.fn(async () => Response.json({ ok: false, error: "invalid_email" })));
    const result = await f.cleanup();
    expect(f.voucher.payment_reminder_sent_at).toBeNull();
    expect(result).toMatchObject({ voucher_reminders_accepted: 0, voucher_reminder_failures: 1 });
  });

  it("surfaces a permanently invalid recipient without calling the provider", async () => {
    const send = vi.fn(async () => Response.json({ ok: true, id: "must-not-send" }));
    const f = fixture(send);
    f.voucher.buyer_email = "invalid";
    const result = await f.cleanup();
    expect(send).not.toHaveBeenCalled();
    expect(f.voucher.payment_reminder_sent_at).toBeNull();
    expect(result).toMatchObject({ voucher_reminders_accepted: 0, voucher_reminder_failures: 1 });
  });

  it("does not stamp a malformed or lost provider response", async () => {
    for (const send of [
      vi.fn(async () => new Response("not-json", { status: 200 })),
      vi.fn(async () => { throw new Error("response lost"); }),
    ]) {
      const f = fixture(send);
      const result = await f.cleanup();
      expect(f.voucher.payment_reminder_sent_at).toBeNull();
      expect(result).toMatchObject({ voucher_reminders_accepted: 0, voucher_reminder_failures: 1 });
    }
  });

  it("rejects every non-string or blank provider acceptance ID", async () => {
    for (const body of [
      { ok: true, id: { invalid: true } },
      { ok: true, id: true },
      { ok: true, id: 42 },
      { ok: true, id: "   " },
      { ok: true },
    ]) {
      const f = fixture(vi.fn(async () => Response.json(body)));
      expect(await f.cleanup()).toMatchObject({ voucher_reminders_accepted: 0, voucher_reminder_failures: 1 });
      expect(f.voucher.payment_reminder_sent_at).toBeNull();
    }
  });

  it("records provider acceptance only after the tenant-scoped marker succeeds", async () => {
    const send = vi.fn(async () => Response.json({ ok: true, id: "email-accepted" }));
    const f = fixture(send);
    const result = await f.cleanup();
    expect(f.voucher.payment_reminder_sent_at).toMatch(/^\d{4}-/);
    expect(f.updates).toHaveLength(1);
    expect(result).toMatchObject({ voucher_reminders_accepted: 1, voucher_reminder_failures: 0 });
    const body = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ type: "VOUCHER_PAYMENT_LINK", data: { voucher_id: voucherId, business_id: businessId } });
    expect(send.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries the same durable intent after an accepted send cannot be stamped", async () => {
    const bodies: string[] = [];
    const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return Response.json({ ok: true, id: "same-email" });
    });
    const f = fixture(send);
    f.failNextStamp();
    expect(await f.cleanup()).toMatchObject({ voucher_reminders_accepted: 0, voucher_reminder_failures: 1 });
    expect(f.voucher.payment_reminder_sent_at).toBeNull();
    expect(await f.cleanup()).toMatchObject({ voucher_reminders_accepted: 1, voucher_reminder_failures: 0 });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it("keeps a delayed overlapping replay neutral after another worker stamps acceptance", async () => {
    let signalSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => { signalSecondStarted = resolve; });
    let releaseSecond!: () => void;
    const secondMayReturn = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let call = 0;
    const send = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        await secondStarted;
        return Response.json({ ok: true, id: "same-email" });
      }
      signalSecondStarted();
      await secondMayReturn;
      return Response.json({ ok: true, id: "same-email", replayed: true });
    });
    const f = fixture(send);
    const first = f.cleanup();
    const second = f.cleanup();
    await Promise.race([first, second]);
    releaseSecond();
    const results = await Promise.all([first, second]);

    expect(send).toHaveBeenCalledTimes(2);
    expect(f.updates).toHaveLength(1);
    expect(results.reduce((sum, result) => sum + result.voucher_reminders_accepted, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.voucher_reminder_failures, 0)).toBe(0);
  });

  it("deletes a voucher already past the 24-hour policy without sending a new reminder", async () => {
    const send = vi.fn(async () => Response.json({ ok: true, id: "must-not-send" }));
    const f = fixture(send, 25 * 60);
    const result = await f.cleanup();
    expect(send).not.toHaveBeenCalled();
    expect(f.deletes).toEqual([voucherId]);
    expect(result.vouchers_cleaned).toBe(1);
  });

  it("rechecks age before each send when a sequential batch crosses the deletion cutoff", async () => {
    const startedAt = Date.now();
    let clock = startedAt;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const send = vi.fn(async () => {
        clock += 70_000;
        return Response.json({ ok: true, id: "accepted-once" });
      });
      const f = fixture(send, 24 * 60 - 65 / 60, 2);
      const result = await f.cleanup();
      expect(send).toHaveBeenCalledTimes(1);
      expect(f.vouchers[0].payment_reminder_sent_at).toMatch(/^\d{4}-/);
      expect(f.vouchers[1].payment_reminder_sent_at).toBeNull();
      expect(result).toMatchObject({ voucher_reminders_accepted: 1, voucher_reminder_failures: 0 });
    } finally {
      now.mockRestore();
    }
  });
});
