import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceExports, sourceFunction } from "../helpers/source-handler";
import { readRefundJournal, saveRefundJournal, unresolvedRefundJournal, reconcileRefundJournal, uncertainRefundJournal } from "../../app/lib/refund-bulk-journal";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});
afterEach(() => vi.unstubAllGlobals());

type Reply = { status?: number; body?: any; malformed?: boolean; throws?: string };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function refundActionFixture(initialReplies: Reply[], auth: "ok" | "missing" | "error" = "ok") {
  const replies = [...initialReplies];
  const bodies: any[] = [];
  const next = () => replies.shift() || { body: { ok: true, refund_status: "REFUNDED" } };
  const invoke = vi.fn(async (_name: string, options: any) => {
    const reply = next();
    bodies.push(options.body);
    if (reply.throws) throw new Error(reply.throws);
    const data = reply.malformed ? {} : reply.body;
    return {
      data,
      error: (reply.status || 200) >= 400 ? { message: reply.body?.error || "Function failed" } : null,
    };
  });
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    const reply = next();
    bodies.push(JSON.parse(String(init?.body)));
    if (reply.throws) throw new Error(reply.throws);
    if (reply.malformed) return new Response("not-json", { status: reply.status || 200 });
    return Response.json(reply.body, { status: reply.status || 200 });
  });
  const exports = sourceExports("app/lib/booking-actions.ts", {
    "./supabase": {
      supabase: {
        auth: { getSession: async () => {
          if (auth === "error") throw new Error("auth unavailable");
          return { data: { session: auth === "missing" ? null : { access_token: "fixture-user-token" } } };
        } },
        functions: { invoke },
      },
    },
  }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid" }, fetchImpl);
  return {
    refund: exports.refundBookingAction as (bookingId: string) => Promise<any>,
    bodies,
    fetchImpl,
  };
}

function bulkHarness(options: {
  ids?: string[];
  refund?: (id: string) => Promise<any>;
  confirmAction?: () => Promise<boolean>;
  auditError?: boolean;
  cancel?: (id: string, options: any) => Promise<any>;
  markPaid?: (id: string) => Promise<any>;
  checkIn?: (id: string, businessId: string, options: any) => Promise<any>;
  serverStatuses?: Record<string, string>;
} = {}) {
  const ids = options.ids || ["booking-a"];
  const bookingsById: Record<string, any> = {};
  ids.forEach((id, index) => { bookingsById[id] = { customer_name: "Guest " + index, arrived_count: index + 1, slot_id: "slot-" + index }; });
  let progress: any[] | null = null;
  let inFlight: string | null = null;
  let auditError: string | null = null;
  const audits: any[] = [];
  const bulkRunRef = { current: null as any };
  const businessIdRef = { current: "tenant-a" };
  const mountedRef = { current: true };
  const refund = options.refund || vi.fn(async () => ({ ok: true, outcome: "completed", data: { refund_status: "REFUNDED" } }));
  const cancel = options.cancel || vi.fn(async () => ({ ok: true }));
  const markPaid = options.markPaid || vi.fn(async () => ({ ok: true }));
  const checkIn = options.checkIn || vi.fn(async () => ({ ok: true }));
  const loadBookings = vi.fn(async () => undefined);
  const run = sourceFunction("app/bookings/page.tsx", "runBulk", {
    selected: new Set(ids),
    bulkRunRef,
    businessIdRef,
    mountedRef,
    businessId: "tenant-a",
    bookingsById,
    bulkProgress: null,
    confirmAction: options.confirmAction || (async () => true),
    confirm: () => true,
    prompt: () => "fixture reason",
    setBulkActionInFlight: (value: string | null) => { inFlight = value; },
    setBulkProgressAction: () => undefined,
    setBulkProgress: (value: any) => { progress = typeof value === "function" ? value(progress) : value; },
    setBulkAuditError: (value: string | null) => { auditError = value; },
    readRefundJournal, saveRefundJournal, unresolvedRefundJournal, reconcileRefundJournal, uncertainRefundJournal,
    lookupRefundStatuses: async (readIds: string[]) => ({ data: readIds.map(id => ({
      id, refund_status: options.serverStatuses?.[id] || "REQUESTED", refund_request_id: options.serverStatuses?.[id] === "REFUND_PENDING" ? "server-request" : null,
    })), error: null }),
    notify: () => undefined,
    cancelBookingAction: cancel,
    refundBookingAction: refund,
    markPaidAction: markPaid,
    checkInAction: checkIn,
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "actor-a" } }, error: null }) },
      from: () => ({
        insert: async (value: any) => {
          audits.push(value);
          return { error: options.auditError ? { message: "audit unavailable" } : null };
        },
      }),
    },
    loadBookings,
    setTimeout: (callback: () => void) => { callback(); return 0; },
  });
  return {
    run,
    refund,
    cancel,
    markPaid,
    checkIn,
    loadBookings,
    audits,
    bulkRunRef,
    businessIdRef,
    mountedRef,
    get progress() { return progress; },
    get inFlight() { return inFlight; },
    get auditError() { return auditError; },
  };
}

function delayedCallerHarness(path: "bookings-bulk" | "executeAutoRefund" | "executeManualRefund" | "executeRefundAll") {
  const session = deferred<{ data: { session: { access_token: string; user: { id: string } } } }>();
  const enteredSession = deferred<void>();
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, refund_status: "REFUNDED" }));
  const actions = sourceExports("app/lib/booking-actions.ts", {
    "./supabase": {
      supabase: {
        auth: { getSession: () => {
          enteredSession.resolve();
          return session.promise;
        } },
      },
    },
  }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid" }, fetchImpl) as {
    processRefundAction: (input: any) => Promise<any>;
    refundBookingAction: (bookingId: string, options?: any) => Promise<any>;
  };
  const refundRunRef = { current: null as any };
  const businessIdRef = { current: "tenant-a" };
  const mountedRef = { current: true };
  const refunds = ["booking-a", "booking-b"].map(id => ({
    id,
    customer_name: id,
    refund_status: "REQUESTED",
    refund_amount: 25,
    total_amount: 100,
  }));
  let results: Record<string, any> = {};
  let progress: any[] | null = null;
  const audits: any[] = [];
  const loads = vi.fn(async () => undefined);
  let run: () => Promise<void>;

  if (path === "bookings-bulk") {
    const execute = sourceFunction("app/bookings/page.tsx", "runBulk", {
      selected: new Set(refunds.map(refund => refund.id)),
      bulkRunRef: refundRunRef,
      businessIdRef,
      mountedRef,
      businessId: "tenant-a",
      bookingsById: Object.fromEntries(refunds.map(refund => [refund.id, refund])),
      confirmAction: async () => true,
      setBulkActionInFlight: () => undefined,
      setBulkProgressAction: () => undefined,
      setBulkProgress: (value: any) => { progress = typeof value === "function" ? value(progress) : value; },
      setBulkAuditError: () => undefined,
      readRefundJournal, saveRefundJournal, unresolvedRefundJournal, reconcileRefundJournal, uncertainRefundJournal,
      lookupRefundStatuses: async (readIds: string[]) => ({ data: readIds.map(id => ({ id, refund_status: "REQUESTED", refund_request_id: null })), error: null }),
      notify: () => undefined,
      refundBookingAction: actions.refundBookingAction,
      supabase: { auth: { getUser: async () => ({ data: { user: { id: "actor-a" } }, error: null }) },
        from: () => ({ insert: async (value: any) => { audits.push(value); return { error: null }; } }) },
      loadBookings: loads,
      setTimeout: (callback: () => void) => { callback(); return 0; },
    });
    run = () => execute("refund");
  } else {
    const execute = sourceFunction("app/refunds/page.tsx", path, {
      businessId: "tenant-a",
      businessIdRef,
      mountedRef,
      refunds,
      refundRunRef,
      processRefundAction: actions.processRefundAction,
      getRefundAmount: (booking: any) => booking.refund_amount,
      setProcessing: () => undefined,
      setResults: (value: any) => { results = typeof value === "function" ? value(results) : value; },
      setBulkHistory: () => undefined,
      readRefundJournal, saveRefundJournal, unresolvedRefundJournal,
      notify: () => undefined,
      supabase: { auth: { getUser: async () => ({ data: { user: { id: "actor-a" } }, error: null }) } },
      load: loads,
      UNKNOWN_REFUND_RESULT: { ok: false, outcome: "unknown" },
      setTimeout: (callback: () => void) => { callback(); return 0; },
    });
    run = path === "executeRefundAll" ? () => execute() : () => execute("booking-a");
  }

  return { actions, audits, businessIdRef, enteredSession, fetchImpl, loads, mountedRef, refundRunRef, run, session };
}

function refundsAllHarness(ids: string[], processRefundAction: (input: any) => Promise<any>, serverStatuses: Record<string, string> = {}) {
  const refundRunRef = { current: null as any };
  const businessIdRef = { current: "tenant-a" };
  const mountedRef = { current: true };
  let history: any[] = [];
  let results: Record<string, any> = {};
  const run = sourceFunction("app/refunds/page.tsx", "executeRefundAll", {
    businessId: "tenant-a", businessIdRef, mountedRef,
    refunds: ids.map(id => ({ id, refund_status: "REQUESTED" })), refundRunRef,
    processRefundAction, setProcessing: () => undefined,
    setResults: (value: any) => { results = typeof value === "function" ? value(results) : value; },
    setBulkHistory: (value: any) => { history = value; },
    readRefundJournal, saveRefundJournal, unresolvedRefundJournal, reconcileRefundJournal, uncertainRefundJournal,
    lookupRefundStatuses: async (readIds: string[]) => ({ data: readIds.map(id => ({
      id, refund_status: serverStatuses[id] || "REQUESTED", refund_request_id: serverStatuses[id] === "REFUND_PENDING" ? "server-request" : null,
    })), error: null }),
    notify: () => undefined,
    supabase: { auth: { getUser: async () => ({ data: { user: { id: "actor-a" } }, error: null }) } },
    load: async () => undefined,
    UNKNOWN_REFUND_RESULT: { ok: false, outcome: "unknown" },
    setTimeout: (callback: () => void) => { callback(); return 0; },
  });
  return { run, businessIdRef, mountedRef, get history() { return history; }, get results() { return results; } };
}

describe("refund action outcome contract", () => {
  it("distinguishes completed, pending, manual action, failed, malformed and exceptional responses", async () => {
    const f = refundActionFixture([
      { body: { ok: true, refund_status: "REFUNDED", amount: 10 } },
      { body: { ok: true, refund_status: "REFUNDED", amount: 11, notification_error: "Email unavailable" } },
      { status: 202, body: { ok: true, pending: true, refund_status: "REFUND_PENDING", amount: 20 } },
      { status: 503, body: { pending: true, error: "Provider result could not be recorded" } },
      { body: { ok: true, pending: true, refund_status: "MANUAL_EFT_REQUIRED", amount: 30 } },
      { status: 502, body: { ok: false, refund_status: "FAILED", error: "Declined" } },
      { malformed: true },
      { throws: "response lost" },
    ]);
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await f.refund("booking-" + i));
    expect(results.map(result => result.outcome)).toEqual(["completed", "completed", "pending", "pending", "manual_action", "failed", "unknown", "unknown"]);
    expect(results.map(result => result.ok)).toEqual([true, true, false, false, false, false, false, false]);
    expect(results[6].error).toMatch(/refresh and reconcile/i);
    expect(results[7].error).toMatch(/existing refund reference/i);
  });

  it.each(["missing", "error"] as const)("stops before submission when session auth is %s", async auth => {
    const f = refundActionFixture([{ body: { ok: true, refund_status: "REFUNDED" } }], auth);
    const result = await f.refund("booking-a");
    expect(result).toMatchObject({ ok: false, outcome: "failed" });
    expect(result.error).toMatch(/sign in again/i);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("retries the same booking body without inventing a client refund reference", async () => {
    const f = refundActionFixture([
      { throws: "response lost" },
      { status: 202, body: { ok: true, pending: true, refund_status: "REFUND_PENDING", request_id: "server-reference" } },
    ]);
    expect((await f.refund("booking-a")).outcome).toBe("unknown");
    expect((await f.refund("booking-a")).outcome).toBe("pending");
    expect(f.bodies).toEqual([{ booking_id: "booking-a" }, { booking_id: "booking-a" }]);
  });

  it("does not dispatch a bulk item under a replacement signed-in actor", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, refund_status: "REFUNDED" }));
    const actions = sourceExports("app/lib/booking-actions.ts", {
      "./supabase": { supabase: { auth: { getSession: async () => ({
        data: { session: { access_token: "fixture-token", user: { id: "other-actor" } } },
      }) } } },
    }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid" }, fetchImpl) as { processRefundAction: (input: any) => Promise<any> };
    expect(await actions.processRefundAction({ bookingId: "booking-a", expectedActorId: "actor-a" }))
      .toMatchObject({ outcome: "unprocessed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps an expired bulk session unsubmitted", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, refund_status: "REFUNDED" }));
    const actions = sourceExports("app/lib/booking-actions.ts", {
      "./supabase": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
    }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid" }, fetchImpl) as { processRefundAction: (input: any) => Promise<any> };
    expect(await actions.processRefundAction({ bookingId: "booking-a", expectedActorId: "actor-a" }))
      .toMatchObject({ outcome: "unprocessed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "Payment credentials for the original payment mode are missing",
    "Cash refunded; voucher credit still needs to be reissued. Please retry.",
  ])("preserves the server's pending explanation: %s", async explanation => {
    const f = refundActionFixture([{ status: 503, body: { pending: true, error: explanation } }]);
    const result = await f.refund("booking-a");
    expect(result).toMatchObject({ ok: false, outcome: "pending" });
    expect(result.message).toContain(explanation);
    expect(result.message).toMatch(/existing refund reference/i);
  });

  it("does not relabel an already-dispatched refund when its caller later becomes stale", async () => {
    const response = deferred<Response>();
    let canSubmit = true;
    const fetchImpl = vi.fn<typeof fetch>(() => response.promise);
    const actions = sourceExports("app/lib/booking-actions.ts", {
      "./supabase": { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "fixture-user-token" } } }) } } },
    }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid" }, fetchImpl) as { processRefundAction: (input: any) => Promise<any> };
    const pending = actions.processRefundAction({ bookingId: "booking-a", canSubmit: () => canSubmit });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    canSubmit = false;
    response.resolve(Response.json({ ok: true, refund_status: "REFUNDED" }));
    await expect(pending).resolves.toMatchObject({ ok: true, outcome: "completed" });
  });
});

describe("authoritative foreground recovery", () => {
  it("replaces browser success with server status and keeps untouched work distinct", async () => {
    const journal = {
      actorId: "actor-a", businessId: "tenant-a", surface: "bookings" as const,
      items: [
        { id: "booking-a", status: "completed" as const },
        { id: "booking-b", status: "submitting" as const },
        { id: "booking-c", status: "unprocessed" as const },
      ],
    };
    const lookup = vi.fn(async () => ({ data: [
      { id: "booking-a", refund_status: "REQUESTED", refund_request_id: null },
      { id: "booking-b", refund_status: "REFUND_PENDING", refund_request_id: "server-reference" },
    ], error: null }));
    const recovered = await reconcileRefundJournal(journal, lookup);
    expect(lookup).toHaveBeenCalledWith(["booking-a", "booking-b"], "tenant-a");
    expect(recovered.items.map(item => item.status)).toEqual(["unknown", "pending", "unprocessed"]);
    expect(journal.items.map(item => item.status)).toEqual(["completed", "submitting", "unprocessed"]);
  });
});

describe("refund dispatch context", () => {
  it.each([
    ["bookings-bulk", "tenant change"],
    ["bookings-bulk", "unmount"],
    ["executeAutoRefund", "tenant change"],
    ["executeAutoRefund", "unmount"],
    ["executeManualRefund", "tenant change"],
    ["executeManualRefund", "unmount"],
    ["executeRefundAll", "tenant change"],
    ["executeRefundAll", "unmount"],
  ] as const)("does not dispatch %s after delayed auth and %s", async (path, interruption) => {
    const f = delayedCallerHarness(path);
    const running = f.run();
    await f.enteredSession.promise;
    expect(f.fetchImpl).not.toHaveBeenCalled();
    if (interruption === "tenant change") f.businessIdRef.current = "tenant-b";
    else f.mountedRef.current = false;
    f.refundRunRef.current.cancelled = true;
    f.session.resolve({ data: { session: { access_token: "fixture-user-token", user: { id: "actor-a" } } } });
    await running;
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.loads).not.toHaveBeenCalled();
    expect(f.audits).toEqual([]);
  });

  it.each(["executeAutoRefund", "executeManualRefund"] as const)("stops stale %s callers before session lookup", async path => {
    const f = delayedCallerHarness(path);
    f.mountedRef.current = false;
    await f.run();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.refundRunRef.current).toBeNull();
  });
});

describe("bookings bulk action runtime", () => {
  it("keeps the selected, submitted and unsubmitted bookings across an interrupted tab", async () => {
    const first = bulkHarness({ ids: ["booking-a", "booking-b"], refund: vi.fn(async () => {
      first.businessIdRef.current = "tenant-b";
      return { ok: true, outcome: "completed" };
    }) });
    await first.run("refund");
    expect(readRefundJournal("bookings", "tenant-a", "actor-a")?.items).toEqual([
      { id: "booking-a", status: "completed" }, { id: "booking-b", status: "unprocessed" },
    ]);
    const refund = vi.fn(async () => ({ ok: true, outcome: "completed" }));
    const restored = bulkHarness({ ids: ["booking-a", "booking-b"], refund, serverStatuses: { "booking-a": "REFUNDED" } });
    await restored.run("refund", true);
    expect(refund).toHaveBeenCalledOnce();
    expect(refund.mock.calls[0][0]).toBe("booking-b");
    expect(restored.progress?.map(item => item.status)).toEqual(["completed", "completed"]);
    expect(readRefundJournal("bookings", "tenant-b", "actor-a")).toBeNull();
    expect(readRefundJournal("bookings", "tenant-a", "other-actor")).toBeNull();
  });

  it("stops before submission if durable browser progress cannot be stored", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("quota"); } });
    const refund = vi.fn(async () => ({ ok: true, outcome: "completed" }));
    const f = bulkHarness({ refund });
    await f.run("refund");
    expect(refund).not.toHaveBeenCalled();
  });

  it("keeps a dispatched item uncertain when its response cannot be saved", async () => {
    const values = new Map<string, string>();
    let writes = 0;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { if (++writes === 3) throw new Error("quota"); values.set(key, value); },
    });
    const refund = vi.fn(async () => ({ ok: true, outcome: "completed" }));
    await bulkHarness({ refund }).run("refund");
    expect(refund).toHaveBeenCalledOnce();
    expect(readRefundJournal("bookings", "tenant-a", "actor-a")?.items[0].status).toBe("submitting");
    const retry = vi.fn(async () => ({ ok: true, outcome: "completed" }));
    const restored = bulkHarness({ refund: retry });
    await restored.run("refund");
    expect(retry).not.toHaveBeenCalled();
    expect(restored.progress?.[0].status).toBe("unknown");
  });

  it("uses its actual result list for mixed refund progress and audit", async () => {
    const outcomes = [
      { ok: true, outcome: "completed" },
      { ok: false, outcome: "pending" },
      { ok: false, outcome: "manual_action" },
      { ok: false, outcome: "failed", error: "Declined" },
      { ok: false, outcome: "unknown", error: "Refresh and reconcile before retrying the existing refund reference." },
    ];
    const f = bulkHarness({ ids: outcomes.map((_, i) => "booking-" + i), refund: vi.fn(async () => outcomes.shift()) });
    await f.run("refund");
    expect(f.progress?.map(item => item.status)).toEqual(["completed", "pending", "manual_action", "failed", "unknown"]);
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0].payload.results.map((item: any) => item.status)).toEqual(["completed", "pending", "manual_action", "failed", "unknown"]);
    expect(f.audits[0].payload).toMatchObject({
      succeeded: ["booking-0"],
      pending: ["booking-1"],
      manual_action: ["booking-2"],
      failed: ["booking-3"],
      unknown: ["booking-4"],
      unprocessed: [],
    });
  });

  it("turns thrown refund calls into unknown outcomes and always clears the spinner", async () => {
    const refund = vi.fn(async (id: string) => {
      if (id === "booking-1") throw new Error("response lost");
      return { ok: id === "booking-0", outcome: id === "booking-0" ? "completed" : "pending" };
    });
    const f = bulkHarness({ ids: ["booking-0", "booking-1", "booking-2"], refund });
    await expect(f.run("refund")).resolves.toBeUndefined();
    expect(f.progress?.map(item => item.status)).toEqual(["completed", "unknown", "pending"]);
    expect(f.inFlight).toBeNull();
    expect(f.bulkRunRef.current).toBeNull();
  });

  it("uses a synchronous guard so repeat clicks submit once", async () => {
    let release!: (value: boolean) => void;
    const confirmation = new Promise<boolean>(resolve => { release = resolve; });
    const refund = vi.fn(async () => ({ ok: true, outcome: "completed" }));
    const f = bulkHarness({ refund, confirmAction: () => confirmation });
    const first = f.run("refund");
    const second = f.run("refund");
    release(true);
    await Promise.all([first, second]);
    expect(refund).toHaveBeenCalledOnce();
  });

  it("does nothing for an empty selection", async () => {
    const confirmAction = vi.fn(async () => true);
    const refund = vi.fn(async () => ({ ok: true, outcome: "completed" }));
    const f = bulkHarness({ ids: [], refund, confirmAction });
    await f.run("refund");
    expect(confirmAction).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
    expect(f.audits).toEqual([]);
  });

  it.each(["tenant change", "unmount"])("stops before the next browser-only item after %s", async interruption => {
    const f = bulkHarness({ ids: ["booking-0", "booking-1", "booking-2"] });
    const refund = f.refund as ReturnType<typeof vi.fn>;
    refund.mockImplementation(async () => {
      if (interruption === "tenant change") f.businessIdRef.current = "tenant-b";
      else f.mountedRef.current = false;
      return { ok: true, outcome: "completed" };
    });
    await f.run("refund");
    expect(refund).toHaveBeenCalledOnce();
    expect(f.audits).toEqual([]);
    expect(f.loadBookings).not.toHaveBeenCalled();
  });

  it("shows an audit failure without changing a completed outcome", async () => {
    const f = bulkHarness({ auditError: true });
    await f.run("refund");
    expect(f.progress?.[0].status).toBe("completed");
    expect(f.auditError).toMatch(/audit log could not be saved/i);
  });

  it("preserves cancel, mark-paid and check-in arguments while reporting completion", async () => {
    const cancel = vi.fn(async () => ({ ok: true }));
    const cancelRun = bulkHarness({ cancel });
    await cancelRun.run("cancel");
    expect(cancel).toHaveBeenCalledWith("booking-a", { reason: "fixture reason", weather: true });
    expect(cancelRun.progress?.[0].status).toBe("completed");

    const markPaid = vi.fn(async () => ({ ok: true }));
    const paidRun = bulkHarness({ markPaid });
    await paidRun.run("markpaid");
    expect(markPaid).toHaveBeenCalledWith("booking-a");
    expect(paidRun.progress?.[0].status).toBe("completed");

    const checkIn = vi.fn(async () => ({ ok: true }));
    const checkInRun = bulkHarness({ checkIn });
    await checkInRun.run("checkin");
    expect(checkIn).toHaveBeenCalledWith("booking-a", "tenant-a", { expectedArrivedCount: 1, slotId: "slot-0" });
    expect(checkInRun.progress?.[0].status).toBe("completed");
  });
});

describe("refund queue foreground recovery", () => {
  it("resumes only the unsubmitted tail after interruption", async () => {
    const first = refundsAllHarness(["booking-a", "booking-b"], vi.fn(async () => {
      first.businessIdRef.current = "tenant-b";
      return { ok: true, outcome: "completed" };
    }));
    await first.run();
    expect(readRefundJournal("refunds", "tenant-a", "actor-a")?.items).toEqual([
      { id: "booking-a", status: "completed" }, { id: "booking-b", status: "unprocessed" },
    ]);
    const process = vi.fn(async () => ({ ok: true, outcome: "completed" }));
    const restored = refundsAllHarness(["booking-a", "booking-b"], process, { "booking-a": "REFUNDED" });
    await restored.run(true);
    expect(process).toHaveBeenCalledOnce();
    expect(process.mock.calls[0][0]).toMatchObject({ bookingId: "booking-b", expectedActorId: "actor-a" });
    expect(restored.history.map(item => item.status)).toEqual(["completed", "completed"]);
  });

  it("keeps a lost response unknown and does not replay it on a later visit", async () => {
    const first = refundsAllHarness(["booking-a", "booking-b"], vi.fn(async input =>
      input.bookingId === "booking-a"
        ? { ok: false, outcome: "unknown" }
        : { ok: true, outcome: "completed" }));
    await first.run();
    expect(readRefundJournal("refunds", "tenant-a", "actor-a")?.items.map(item => item.status))
      .toEqual(["unknown", "completed"]);
    const process = vi.fn(async () => ({ ok: true, outcome: "completed" }));
    const restored = refundsAllHarness(["booking-a", "booking-b"], process, { "booking-b": "REFUNDED" });
    await restored.run(true);
    expect(process).not.toHaveBeenCalled();
  });
});

describe("refund queue routing", () => {
  it("routes individual, manual and all-item submissions through the shared outcome action", () => {
    const source = readFileSync("app/refunds/page.tsx", "utf8");
    expect(source).toContain('import { processRefundAction');
    expect(source.match(/processRefundAction\(/g)).toHaveLength(3);
    expect(source).not.toContain('functions.invoke("process-refund"');
    expect(source).not.toContain('fetch(SU + "/functions/v1/process-refund"');
    expect(source).not.toContain("Pending provider confirmation");
    expect(source).toContain('res?.message || res?.error');
  });
});
