import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginGuideQueueAuthGeneration,
  clearGuideQueueAuthContext,
  createGuideQueueItem,
  currentGuideQueueAuthGeneration,
  guideQueueAuthContext,
  postGuideQueueAuthContext,
  registerGuideCheckInSync,
} from "../../app/lib/guide-offline";
import { sourceFunction, sourceHandler } from "../helpers/source-handler";

afterEach(() => vi.unstubAllGlobals());

type QueueItem = {
  id: string;
  payload: { booking_id: string; slot_id: string; client_event_id: string };
  queuedAt: number;
  userId?: string;
  businessId?: string;
  token?: string;
  status?: string;
  attempts?: number;
  lastError?: string;
};

const boundItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: "event-a",
  payload: { booking_id: "booking-a", slot_id: "slot-a", client_event_id: "event-a" },
  queuedAt: 1,
  userId: "user-a",
  businessId: "business-a",
  status: "pending",
  attempts: 0,
  ...overrides,
});

function syncFixture(options: {
  item?: QueueItem;
  items?: QueueItem[];
  auth?: { userId: string; businessId: string; accessToken: string } | null;
  response?: number | "network";
  clearAuthResult?: boolean;
} = {}) {
  const stored = new Map<string, QueueItem>();
  const items = options.items || [options.item || boundItem()];
  items.forEach((item) => stored.set(item.id, structuredClone(item)));
  const auth = options.auth === undefined
    ? { userId: "user-a", businessId: "business-a", accessToken: "current-token" }
    : options.auth;
  const deleted: string[] = [];
  const statuses: unknown[] = [];
  let clearedAuth = 0;
  let registered = 0;
  const fetchImpl = vi.fn(async () => {
    if (options.response === "network") throw new Error("offline");
    return new Response(null, { status: options.response || 200 });
  });
  const db = { close: vi.fn() };
  const bindings = {
    MAX_SYNC_ITEMS: 25,
    openDb: async () => db,
    idbGetAll: async () => Array.from(stored.values()).map((value) => structuredClone(value)),
    idbGetAuthState: async () => ({ generation: 10, context: auth }),
    idbPut: async (_db: unknown, value: QueueItem) => { stored.set(value.id, structuredClone(value)); },
    idbDelete: async (_db: unknown, id: string) => { deleted.push(id); stored.delete(id); },
    idbClearAuthIfGeneration: async () => { clearedAuth += 1; return options.clearAuthResult ?? true; },
    postQueueStatus: async (...args: unknown[]) => { statuses.push(args); },
    registerCheckInSync: async () => { registered += 1; },
    fetch: fetchImpl,
  };
  const sync = sourceFunction("public/guide/sw.js", "syncCheckIns", bindings);
  return {
    auth,
    clearedAuth: () => clearedAuth,
    deleted,
    fetchImpl,
    registered: () => registered,
    statuses,
    stored,
    sync,
  };
}

describe("offline guide check-in replay", () => {
  it("creates only owner-bound queue records without persisting bearer tokens", () => {
    const auth = guideQueueAuthContext({ access_token: "current-token", user: { id: "user-a" } }, "business-a");
    expect(auth).toEqual({ userId: "user-a", businessId: "business-a", accessToken: "current-token" });
    expect(guideQueueAuthContext({ access_token: "current-token", user: null }, "business-a")).toBeNull();
    expect(guideQueueAuthContext({ access_token: "current-token", user: { id: "user-a" } }, "")).toBeNull();

    const item = createGuideQueueItem(boundItem().payload, auth!);
    expect(item).toMatchObject({ id: "event-a", userId: "user-a", businessId: "business-a", status: "pending", attempts: 0 });
    expect(item).not.toHaveProperty("token");
  });

  it("rejects a delayed auth publication after its client generation is invalidated", async () => {
    const staleGeneration = currentGuideQueueAuthGeneration();
    beginGuideQueueAuthGeneration();
    const auth = { userId: "user-a", businessId: "business-a", accessToken: "stale-token" };

    await expect(postGuideQueueAuthContext(auth, staleGeneration)).resolves.toBe(false);
    await expect(clearGuideQueueAuthContext(staleGeneration)).resolves.toBe(false);
  });

  it("uses the v2 sync tag when Background Sync is available", async () => {
    const register = vi.fn(async () => {});
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ sync: { register } }) } });

    await registerGuideCheckInSync();

    expect(register).toHaveBeenCalledWith("sync-check-ins-v2");
  });

  it("requests foreground replay when Background Sync is unavailable", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ active: { postMessage } }) } });

    await registerGuideCheckInSync();

    expect(postMessage).toHaveBeenCalledWith({ type: "GUIDE_SYNC_REQUEST" });
  });

  it("copies legacy work into the parallel queue without its bearer token", async () => {
    const legacyDb = { close: vi.fn() };
    const currentDb = { close: vi.fn() };
    const writes: Array<{ db: unknown; item: QueueItem }> = [];
    const migrate = sourceFunction("public/guide/sw.js", "migrateLegacyQueue", {
      openLegacyDb: async () => legacyDb,
      openDb: async () => currentDb,
      idbGetAll: async () => [boundItem({ userId: undefined, businessId: undefined, token: "legacy-token" })],
      idbPut: async (db: unknown, item: QueueItem) => { writes.push({ db, item: structuredClone(item) }); },
    });

    await migrate();

    expect(writes).toHaveLength(2);
    expect(writes.map(({ db }) => db)).toEqual([currentDb, legacyDb]);
    for (const { item } of writes) {
      expect(item).toMatchObject({ id: "event-a", status: "blocked_legacy", lastError: "missing_owner" });
      expect(item).not.toHaveProperty("token");
    }
    expect(legacyDb.close).toHaveBeenCalledOnce();
    expect(currentDb.close).toHaveBeenCalledOnce();
  });

  it("applies only current-or-newer worker auth generations and conditionally clears them", async () => {
    let state: { generation: number; context: unknown } = { generation: 10, context: { userId: "user-a" } };
    const writes: unknown[] = [];
    const db = { transaction: () => {
      const tx: any = {};
      const store = {
        get: () => {
          const request: any = { result: state };
          queueMicrotask(() => {
            request.onsuccess?.();
            queueMicrotask(() => tx.oncomplete?.());
          });
          return request;
        },
        put: (value: typeof state) => { state = value; writes.push(structuredClone(value)); },
      };
      tx.objectStore = () => store;
      return tx;
    } };
    const authBindings = { AUTH_STORE: "auth-context", AUTH_KEY: "current" };
    const apply = sourceFunction("public/guide/sw.js", "idbApplyAuthContext", authBindings);
    const clear = sourceFunction("public/guide/sw.js", "idbClearAuthIfGeneration", authBindings);

    await expect(apply(db, { userId: "user-stale" }, 9)).resolves.toBe(false);
    expect(writes).toEqual([]);
    await expect(apply(db, { userId: "user-b" }, 11)).resolves.toBe(true);
    expect(state).toEqual({ generation: 11, context: { userId: "user-b" } });
    await expect(clear(db, 10)).resolves.toBe(false);
    expect(state.context).toEqual({ userId: "user-b" });
    await expect(clear(db, 11)).resolves.toBe(true);
    expect(state).toEqual({ generation: 11, context: null });
  });

  it("deletes only a successfully completed item and uses the current bound authority", async () => {
    const f = syncFixture({ item: boundItem({ token: "stale-token" }) });
    await f.sync();

    expect(f.deleted).toEqual(["event-a"]);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    const [, init] = f.fetchImpl.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer current-token");
    expect((init?.headers as Record<string, string>)["x-admin-business-id"]).toBe("business-a");
  });

  it("retains a 401, requests reauthentication, and clears the rejected authority", async () => {
    const f = syncFixture({ response: 401 });
    await f.sync();

    expect(f.stored.get("event-a")).toMatchObject({ status: "needs_reauth", lastError: "unauthorized" });
    expect(f.deleted).toEqual([]);
    expect(f.clearedAuth()).toBe(1);
    expect(f.statuses.length).toBeGreaterThan(0);
  });

  it("does not clear refreshed authority when an older request returns 401", async () => {
    const f = syncFixture({ response: 401, clearAuthResult: false });
    await expect(f.sync()).rejects.toThrow("Guide check-in sync remains retryable");

    expect(f.stored.get("event-a")).toMatchObject({ status: "pending", lastError: "auth_changed", attempts: 1 });
    expect(f.deleted).toEqual([]);
  });

  for (const response of [429, 500, "network"] as const) {
    it(`retains retryable ${response} work and rejects the sync for browser retry`, async () => {
      const f = syncFixture({ response });
      await expect(f.sync()).rejects.toThrow("Guide check-in sync remains retryable");

      expect(f.stored.get("event-a")).toMatchObject({ status: "pending", attempts: 1 });
      expect(f.deleted).toEqual([]);
    });
  }

  it("retains a terminal client rejection with a visible failed state", async () => {
    const f = syncFixture({ response: 422 });
    await f.sync();

    expect(f.stored.get("event-a")).toMatchObject({ status: "failed", lastError: "http_422" });
    expect(f.deleted).toEqual([]);
    expect(f.statuses.length).toBeGreaterThan(0);
  });

  it("quarantines work owned by another account without making a request", async () => {
    const f = syncFixture({ auth: { userId: "user-b", businessId: "business-a", accessToken: "other-token" } });
    await f.sync();

    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.stored.get("event-a")).toMatchObject({ status: "blocked_account" });
    expect(f.deleted).toEqual([]);
  });

  it("quarantines legacy unbound work and removes its stale token", async () => {
    const f = syncFixture({ item: boundItem({ userId: undefined, businessId: undefined, token: "legacy-token" }) });
    await f.sync();

    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.stored.get("event-a")).toMatchObject({ status: "blocked_legacy" });
    expect(f.stored.get("event-a")).not.toHaveProperty("token");
    expect(f.deleted).toEqual([]);
  });

  it("does not let retained terminal rows starve later replayable work", async () => {
    const terminal = Array.from({ length: 25 }, (_, index) => boundItem({ id: `failed-${index}`, status: "failed" }));
    const valid = boundItem({ id: "valid-later" });
    const f = syncFixture({ items: [...terminal, valid] });

    await f.sync();

    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(f.deleted).toEqual(["valid-later"]);
    expect(f.stored.has("valid-later")).toBe(false);
  });

  it("reports progress and drains a queue larger than the bounded batch across continuations", async () => {
    const items = Array.from({ length: 126 }, (_, index) => boundItem({ id: `event-${index}`, queuedAt: index }));
    const f = syncFixture({ items });

    for (let batch = 0; batch < 6; batch += 1) await f.sync();

    expect(f.fetchImpl).toHaveBeenCalledTimes(126);
    expect(f.stored.size).toBe(0);
    expect(f.registered()).toBe(5);
    expect(f.statuses.slice(0, 5).every((args: any) => args[1]?.progressed === 25 && args[1]?.deferred === true)).toBe(true);
    expect((f.statuses[5] as any)[1]).toMatchObject({ progressed: 1, deferred: false });
  });
});

describe("guide authority lifecycle", () => {
  it("invalidates persisted guide authority during a central operator switch", () => {
    const clearGuideQueueAuthContext = vi.fn(async () => true);
    const selected: string[] = [];
    const localValues = new Map<string, string>();
    const switchOperator = sourceFunction("components/AuthGate.tsx", "switchOperator", {
      businessId: "business-a",
      operators: [{ id: "business-b", name: "B", logoUrl: "b.png", timezone: "Africa/Johannesburg", subscriptionStatus: "ACTIVE", yocoTestMode: false }],
      clearGuideQueueAuthContext,
      contextRequestRef: { current: 0 },
      localStorage: { setItem: (key: string, value: string) => localValues.set(key, value) },
      setBusinessId: (value: string) => selected.push(value),
      setBusinessName: vi.fn(),
      setLogoUrl: vi.fn(),
      setTimezone: vi.fn(),
      setSubscriptionStatus: vi.fn(),
      setYocoTestMode: vi.fn(),
    });

    switchOperator("business-b");

    expect(clearGuideQueueAuthContext).toHaveBeenCalledOnce();
    expect(selected).toEqual(["business-b"]);
    expect(localValues.get("ck_admin_business_id")).toBe("business-b");
  });
});

function apiFixture(options: {
  insertError?: { code?: string; message: string } | null;
  updateError?: { message: string } | null;
  bookingSlot?: string;
  bookingBusiness?: string;
  caller?: { id: string; business_id: string } | null;
  bookingCheckedIn?: boolean;
  bookingCheckedInAt?: string | null;
  existingEventAt?: string;
} = {}) {
  const booking = {
    id: "booking-a",
    business_id: options.bookingBusiness || "business-a",
    slot_id: options.bookingSlot || "slot-a",
    checked_in: options.bookingCheckedIn || false,
    checked_in_at: options.bookingCheckedInAt || null,
  };
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const updateFilters: Array<[string, unknown]> = [];
  const db = {
    from(table: string) {
      if (table === "slot_check_ins") {
        const query: any = {
          insert: async (value: unknown) => { inserts.push(value); return { error: options.insertError || null }; },
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: { checked_in_at: options.existingEventAt || "2026-09-20T08:00:00.000Z" }, error: null }),
        };
        return query;
      }
      if (table !== "bookings") throw new Error(`Unexpected table ${table}`);
      let isUpdate = false;
      const query: any = {
        select: () => query,
        update: (value: unknown) => { isUpdate = true; updates.push(value); return query; },
        eq: (key: string, value: unknown) => { if (isUpdate) updateFilters.push([key, value]); return query; },
        maybeSingle: async () => ({ data: booking, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise
          .resolve({ data: null, error: options.updateError || null })
          .then(resolve, reject),
      };
      return query;
    },
  };
  const caller = Object.hasOwn(options, "caller") ? options.caller : { id: "admin-a", business_id: "business-a" };
  const handler = sourceHandler("app/api/guide/check-in/route.ts", {
    "@/app/lib/api-auth": { getCallerAdmin: async () => caller },
    "@supabase/supabase-js": { createClient: () => db },
  });
  const invoke = (body: Record<string, unknown>) => handler(new Request("https://fixture.invalid/api/guide/check-in", {
    method: "POST",
    body: JSON.stringify({ booking_id: "booking-a", slot_id: "slot-a", client_event_id: "event-a", ...body }),
  }));
  return { inserts, invoke, updateFilters, updates };
}

describe("guide check-in API convergence", () => {
  it("denies an unauthenticated caller without side effects", async () => {
    const f = apiFixture({ caller: null });
    expect((await f.invoke({})).status).toBe(401);
    expect(f.inserts).toEqual([]);
    expect(f.updates).toEqual([]);
  });

  it("denies a foreign-tenant booking without side effects", async () => {
    const f = apiFixture({ bookingBusiness: "business-b" });
    expect((await f.invoke({})).status).toBe(403);
    expect(f.inserts).toEqual([]);
    expect(f.updates).toEqual([]);
  });

  it("rejects a supplied slot that does not own the booking before inserting", async () => {
    const f = apiFixture({ bookingSlot: "slot-real" });
    expect((await f.invoke({ slot_id: "slot-forged" })).status).toBe(400);
    expect(f.inserts).toEqual([]);
    expect(f.updates).toEqual([]);
  });

  it("returns 5xx and remains retryable when the booking state update fails", async () => {
    const f = apiFixture({ updateError: { message: "fixture update failure" } });
    expect((await f.invoke({})).status).toBe(500);
    expect(f.inserts).toHaveLength(1);
    expect(f.updates).toHaveLength(1);
  });

  it("retries convergence after a duplicate client event", async () => {
    const f = apiFixture({ insertError: { code: "23505", message: "duplicate" }, existingEventAt: "2026-09-20T07:30:00.000Z" });
    const response = await f.invoke({});

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, replay: true });
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0]).toMatchObject({ checked_in_at: "2026-09-20T07:30:00.000Z" });
  });

  it("does not change an already completed booking timestamp on response-loss replay", async () => {
    const f = apiFixture({
      insertError: { code: "23505", message: "duplicate" },
      bookingCheckedIn: true,
      bookingCheckedInAt: "2026-09-20T07:30:00.000Z",
    });
    const response = await f.invoke({});

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, replay: true });
    expect(f.updates).toEqual([]);
  });

  it("does not change an already completed booking timestamp for a later event id", async () => {
    const f = apiFixture({ bookingCheckedIn: true, bookingCheckedInAt: "2026-09-20T07:30:00.000Z" });
    const response = await f.invoke({ client_event_id: "event-later" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, already_checked_in: true });
    expect(f.inserts).toHaveLength(1);
    expect(f.updates).toEqual([]);
  });

  it("preserves the authorized own-tenant success path and scopes the final update", async () => {
    const f = apiFixture();
    expect((await f.invoke({})).status).toBe(200);
    expect(f.inserts).toHaveLength(1);
    expect(f.updates).toHaveLength(1);
    expect(f.updateFilters).toEqual([["id", "booking-a"], ["business_id", "business-a"]]);
  });
});
