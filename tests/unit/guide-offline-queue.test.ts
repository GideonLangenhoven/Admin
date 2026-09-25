import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import * as guideOffline from "../../app/lib/guide-offline";
import {
  activateGuideQueueAuthContext,
  clearGuideQueueAuthContext,
  createGuideQueueItem,
  currentGuideQueueAuthority,
  currentGuideQueueAuthGeneration,
  establishGuideQueueAuthority,
  guideQueueAuthContext,
  isCurrentGuideQueueAuthClear,
  postGuideQueueAuthContext,
  registerGuideCheckInSync,
  sameGuideAuthSession,
  type GuideCheckInPayload,
} from "../../app/lib/guide-offline";
import { sourceFunction } from "../helpers/source-handler";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type QueueItem = {
  id: string;
  payload: GuideCheckInPayload;
  queuedAt: number;
  updatedAt?: number;
  userId?: string;
  businessId?: string;
  token?: string;
  status?: string;
  attempts?: number;
  lastError?: string;
  nextAttemptAt?: number;
};

const payload = (eventId = "event-a", bookingId = "booking-a"): GuideCheckInPayload => ({
  booking_id: bookingId,
  slot_id: "slot-a",
  arrived_count: null,
  expected_arrived_count: 2,
  client_event_id: eventId,
});

const boundItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: "event-a",
  payload: payload(),
  queuedAt: 1,
  userId: "user-a",
  businessId: "business-a",
  status: "pending",
  attempts: 0,
  ...overrides,
});

function stubGuideAuthIndexedDb(initial: unknown = null, options: { abort?: boolean; error?: boolean; defer?: boolean } = {}) {
  let state = initial;
  let releaseTransaction: (() => void) | undefined;
  const transactionGate = options.defer ? new Promise<void>(resolve => { releaseTransaction = resolve; }) : null;
  let transactionTail = Promise.resolve();
  const db: any = {
    close: vi.fn(),
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx: any = {};
      const previousTransaction = transactionTail;
      let finishTransaction!: () => void;
      transactionTail = new Promise<void>(resolve => { finishTransaction = resolve; });
      let pending: unknown;
      const store = {
        get: () => {
          const request: any = {};
          void previousTransaction.then(() => {
            pending = structuredClone(state);
            request.result = structuredClone(state);
            queueMicrotask(() => {
              request.onsuccess?.();
              const complete = () => queueMicrotask(() => {
                if (options.abort) {
                  tx.error = new Error("transaction aborted");
                  tx.onabort?.();
                } else if (options.error) {
                  tx.error = new Error("transaction failed");
                  tx.onerror?.();
                } else {
                  state = pending;
                  tx.oncomplete?.();
                }
                finishTransaction();
              });
              if (transactionGate) transactionGate.then(complete);
              else complete();
            });
          });
          return request;
        },
        put: (value: unknown) => { pending = structuredClone(value); },
      };
      tx.objectStore = () => store;
      return tx;
    },
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: any = { result: db };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  return { db, release: () => releaseTransaction?.(), state: () => structuredClone(state) };
}

function exclusiveTransitionLock() {
  let tail = Promise.resolve();
  return async <T>(work: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

function guideStatusHandlerFixture(authority: {
  generation: number;
  authorityId: string;
  userId: string;
  businessId: string;
}) {
  const callbacks: Record<string, (event: { data: Record<string, unknown> }) => void> = {};
  const effects: Array<() => void | (() => void)> = [];
  const changes: unknown[] = [];
  const dispatched: Array<{ type: string; detail: unknown }> = [];
  const retries = { current: 3 };
  const loadedModule = { exports: {} as Record<string, any> };
  const source = ts.transpileModule(readFileSync("components/GuideServiceWorker.tsx", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const noop = () => {};
  runInNewContext(source, {
    module: loadedModule,
    exports: loadedModule.exports,
    console,
    CustomEvent: class {
      type: string;
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) { this.type = type; this.detail = init.detail; }
    },
    window: { addEventListener: noop, removeEventListener: noop, dispatchEvent: (event: any) => dispatched.push(event) },
    navigator: {
      onLine: true,
      serviceWorker: {
        addEventListener: (name: string, callback: (event: any) => void) => { callbacks[name] = callback; },
        removeEventListener: noop,
        register: () => new Promise(() => {}),
      },
    },
    require: (name: string) => {
      if (name === "react") return {
        useEffect: (effect: () => void | (() => void)) => effects.push(effect),
        useRef: () => retries,
        useState: (initial: unknown) => [initial, (value: unknown) => changes.push(typeof value === "function" ? (value as (n: number) => unknown)(0) : value)],
      };
      if (name === "react/jsx-runtime") return {};
      if (name.endsWith("/guide-offline")) return {
        acknowledgeGuideQueueIssue: vi.fn(), retryGuideQueueIssue: vi.fn(),
        currentGuideQueueAuthority: () => authority,
        currentGuideQueueAuthGeneration: () => authority.generation,
        GUIDE_QUEUE_UPDATE_EVENT: "guide-queue-update",
        guideQueueAuthContext: vi.fn(), isCurrentGuideQueueAuthContext: () => true,
        postGuideQueueAuthContext: vi.fn(), registerGuideCheckInSync: vi.fn(), requestGuideQueueStatus: vi.fn(),
      };
      if (name.endsWith("/supabase")) return {
        supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }) } },
      };
      if (name.endsWith("/BusinessContext")) return {
        useBusinessContext: () => ({ businessId: authority.businessId, readOnly: false }),
      };
      throw new Error(`Unexpected component import: ${name}`);
    },
  });
  loadedModule.exports.default();
  const cleanup = effects[0]();
  return {
    receive: (message: Record<string, unknown>) => callbacks.message({ data: message }),
    changes,
    dispatched,
    retries,
    cleanup: typeof cleanup === "function" ? cleanup : noop,
  };
}

function loginCleanupFixture(cleanupClearResult: number | null, signInError: { status?: number; message: string } | null = null) {
  const session = { access_token: "token-a", user: { id: "user-a" } };
  const authSessionRef = { current: null as typeof session | null };
  const log: string[] = [];
  const setError = vi.fn();
  const setItem = vi.fn();
  let clearCalls = 0;
  let queueAuthorityLive = false;
  const noop = vi.fn();
  const login = sourceFunction("components/AuthGate.tsx", "login", {
    email: "a@example.invalid",
    pass: "test",
    pathname: "/",
    MAX_ATTEMPTS: 5,
    LOCKOUT_DURATION: 30 * 60 * 1000,
    setLoading: noop,
    setError,
    setNotice: noop,
    setLocked: noop,
    setRole: noop,
    setReadOnly: noop,
    setBusinessId: noop,
    setBusinessName: noop,
    setLogoUrl: noop,
    setTimezone: noop,
    setOperators: noop,
    setSubscriptionStatus: noop,
    setYocoTestMode: noop,
    setHostMismatch: noop,
    setAuthed: noop,
    localStorage: {
      getItem: () => null,
      setItem,
      removeItem: () => {
        if (queueAuthorityLive) throw new Error("storage unavailable after authority publication");
      },
    },
    document: { cookie: "" },
    window: { location: { search: "", href: "https://test.invalid/", replace: noop }, history: { replaceState: noop } },
    currentGuideQueueAuthGeneration: () => 10,
    authTransitionAbortRef: { current: { signal: new AbortController().signal } },
    withGuideAuthTransitionLock: async (work: () => Promise<unknown>) => work(),
    clearGuideQueueAuthContext: async () => {
      clearCalls += 1;
      log.push(`clear:${clearCalls}`);
      return clearCalls === 1 ? 11 : cleanupClearResult;
    },
    isCurrentGuideQueueAuthClear: (generation: number) => generation === 11 || generation === cleanupClearResult,
    sameGuideAuthSession,
    activateGuideQueueAuthContext: async () => {
      queueAuthorityLive = true;
      log.push("authority");
      return 12;
    },
    guideQueueAuthContext: () => ({ userId: "user-a", businessId: "business-a", accessToken: "token-a" }),
    guideAuthorityEpochRef: { current: 10 },
    authSessionRef,
    loadBusinessContext: async () => ({ businessId: "business-a" }),
    supabase: { auth: {
      signInWithPassword: async () => signInError
        ? ({ data: { session: null }, error: signInError })
        : ({ data: { session }, error: null }),
      getSession: async () => ({ data: { session } }),
      signOut: async () => { log.push("signOut"); },
    } },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        auth_ready: true,
        admin: { business_id: "business-a", role: "ADMIN", email: "a@example.invalid" },
      }),
    }),
    sendAdminSetupLink: vi.fn(),
    console: { error: vi.fn() },
  });
  return { authSessionRef, log, login, setError, setItem, session };
}

function workerRetryBindings() {
  const constants = {
    MAX_AUTO_ATTEMPTS: 5,
    BASE_RETRY_DELAY_MS: 5_000,
    MAX_RETRY_DELAY_MS: 15 * 60_000,
  };
  const retryDelayMs = sourceFunction("public/guide/sw.js", "retryDelayMs", constants);
  return {
    ...constants,
    retryDelayMs,
    retryQueueItem: sourceFunction("public/guide/sw.js", "retryQueueItem", { ...constants, retryDelayMs }),
    workerAuthority: sourceFunction("public/guide/sw.js", "workerAuthority", {}),
    sameWorkerAuthority: sourceFunction("public/guide/sw.js", "sameWorkerAuthority", {}),
  };
}

function syncFixture(options: {
  item?: QueueItem;
  items?: QueueItem[];
  auth?: { userId: string; businessId: string; accessToken: string } | null;
  response?: number | "network" | ((item: QueueItem) => number | "network" | Promise<number | "network">);
  responseBody?: Record<string, unknown>;
  responseBodyError?: boolean;
  responseHeaders?: Record<string, string>;
  clearAuthResult?: boolean;
  maxItems?: number;
  registerResult?: boolean;
} = {}) {
  const stored = new Map<string, QueueItem>();
  const items = options.items || [options.item || boundItem()];
  items.forEach(item => stored.set(item.id, structuredClone(item)));
  const auth = options.auth === undefined
    ? { userId: "user-a", businessId: "business-a", accessToken: "current-token" }
    : options.auth;
  const workerAuth = auth ? { ...auth, credentialId: `credential:${auth.accessToken}` } : null;
  let authState = {
    generation: 10,
    authorityId: "authority-a",
    context: workerAuth,
    owner: auth ? { userId: auth.userId, businessId: auth.businessId } : null,
  };
  const deleted: string[] = [];
  const statuses: unknown[][] = [];
  let clearedAuth = 0;
  let registered = 0;
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body || "{}"));
    const item = stored.get(sent.client_event_id) || boundItem({ id: sent.client_event_id, payload: sent });
    const response = typeof options.response === "function" ? await options.response(item) : options.response;
    if (response === "network") throw new Error("offline");
    const status = response || 200;
    if (options.responseBodyError) {
      return { ok: true, status, headers: new Headers(options.responseHeaders), json: async () => { throw new Error("body lost"); } } as Response;
    }
    const body = options.responseBody || (status === 200
      ? { ok: true, replay: false, arrived_count: 4, qty: 4, checked_in: true, checked_in_at: "2026-09-20T08:00:00.000Z", slot_id: "slot-a" }
      : { ok: false, error: "fixture rejection" });
    return Response.json(body, { status, headers: options.responseHeaders });
  });
  const db = { close: vi.fn() };
  const bindings = {
    ...workerRetryBindings(),
    MAX_SYNC_ITEMS: options.maxItems || 25,
    openDb: async () => db,
    idbGetAll: async () => Array.from(stored.values()).map(value => structuredClone(value)),
    idbGetAuthState: async () => structuredClone(authState),
    idbPut: async (_db: unknown, value: QueueItem) => { stored.set(value.id, structuredClone(value)); },
    idbDelete: async (_db: unknown, id: string) => { deleted.push(id); stored.delete(id); },
    idbClearAuthIfCredential: async (_db: unknown, generation: number, authorityId: string, credentialId: string) => {
      clearedAuth += 1;
      if (options.clearAuthResult !== undefined) return options.clearAuthResult;
      if (authState.generation !== generation || authState.authorityId !== authorityId
          || authState.context?.credentialId !== credentialId) return false;
      authState = { ...authState, context: null };
      return true;
    },
    postQueueStatus: async (...args: unknown[]) => { statuses.push(args); },
    registerCheckInSync: async () => { registered += 1; return options.registerResult ?? true; },
    canonicalCheckInResponse: sourceFunction("public/guide/sw.js", "canonicalCheckInResponse", {}),
    syncFlight: null,
    fetch: fetchImpl,
  };
  const sync = sourceFunction("public/guide/sw.js", "syncCheckIns", bindings);
  return {
    clearedAuth: () => clearedAuth,
    deleted,
    fetchImpl,
    registered: () => registered,
    authState: () => structuredClone(authState),
    setAuth: (context: NonNullable<typeof auth>) => {
      authState = {
        ...authState,
        context: { ...context, credentialId: `credential:${context.accessToken}` },
        owner: { userId: context.userId, businessId: context.businessId },
      };
    },
    statuses,
    stored,
    sync,
  };
}

describe("offline guide check-in replay", () => {
  it("creates owner-bound partial-arrival records without payload tenant IDs or per-item tokens", () => {
    const auth = guideQueueAuthContext({ access_token: "current-token", user: { id: "user-a" } }, "business-a");
    expect(auth).toEqual({ userId: "user-a", businessId: "business-a", accessToken: "current-token" });
    expect(guideQueueAuthContext({ access_token: "current-token", user: null }, "business-a")).toBeNull();
    expect(guideQueueAuthContext({ access_token: "current-token", user: { id: "user-a" } }, "")).toBeNull();

    const item = createGuideQueueItem(payload(), auth!);
    expect(item).toMatchObject({ id: "event-a", userId: "user-a", businessId: "business-a", status: "pending", attempts: 0 });
    expect(Object.keys(item.payload).sort()).toEqual([
      "arrived_count",
      "booking_id",
      "client_event_id",
      "expected_arrived_count",
      "slot_id",
    ]);
    expect(item).not.toHaveProperty("token");
    expect(item.payload).not.toHaveProperty("business_id");
  });

  it("rejects delayed auth publication after its client generation is invalidated", async () => {
    stubGuideAuthIndexedDb();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ active: { postMessage: vi.fn() } }) },
    });
    const auth = { userId: "user-a", businessId: "business-a", accessToken: "stale-token" };
    const initialGeneration = currentGuideQueueAuthGeneration();
    const staleGeneration = establishGuideQueueAuthority(auth, initialGeneration)!;
    await clearGuideQueueAuthContext(staleGeneration, auth);

    await expect(postGuideQueueAuthContext(auth, staleGeneration)).resolves.toBe(false);
    await expect(clearGuideQueueAuthContext(staleGeneration)).resolves.toBeNull();
  });

  it("cancels credential publication when its foreground action ends during worker lookup", async () => {
    stubGuideAuthIndexedDb();
    const values = new Map<string, string>();
    const postMessage = vi.fn();
    let releaseRegistration!: () => void;
    let registrationStarted = false;
    const registrationGate = new Promise<void>(resolve => { releaseRegistration = resolve; });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => undefined } });
    const context = { userId: "user-a", businessId: "business-a", accessToken: "token-a" };
    const initial = currentGuideQueueAuthGeneration();
    await clearGuideQueueAuthContext(initial);
    const generation = establishGuideQueueAuthority(context, currentGuideQueueAuthGeneration())!;
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: async () => {
          registrationStarted = true;
          await registrationGate;
          return { active: { postMessage } };
        },
      },
    });
    let active = true;

    const publishing = postGuideQueueAuthContext(context, generation, () => active);
    await vi.waitFor(() => expect(registrationStarted).toBe(true));
    active = false;
    releaseRegistration();

    await expect(publishing).resolves.toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
    expect(readFileSync("components/GuideServiceWorker.tsx", "utf8"))
      .toContain("postGuideQueueAuthContext(context, generation, () => active)");
    expect(readFileSync("app/guide/slot/[slotId]/page.tsx", "utf8"))
      .toContain("postGuideQueueAuthContext(auth, authGeneration, canUpdate)");
  });

  it("uses one shared authority epoch so a stale tab cannot restore a cleared account", async () => {
    stubGuideAuthIndexedDb();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ active: { postMessage: vi.fn() } }) },
    });
    const api = guideOffline as unknown as {
      establishGuideQueueAuthority(context: { userId: string; businessId: string; accessToken: string }, expected: number): number | null;
      currentGuideQueueAuthGeneration(): number;
      clearGuideQueueAuthContext(expected: number, context: { userId: string; businessId: string; accessToken: string }): Promise<number | null>;
    };
    const accountA = { userId: "user-a", businessId: "business-a", accessToken: "token-a" };
    const accountB = { userId: "user-b", businessId: "business-b", accessToken: "token-b" };
    const initial = api.currentGuideQueueAuthGeneration();
    const accountAEpoch = api.establishGuideQueueAuthority(accountA, initial)!;
    const clearedEpoch = await api.clearGuideQueueAuthContext(accountAEpoch, accountA);

    expect(clearedEpoch).not.toBeNull();
    expect(api.establishGuideQueueAuthority(accountA, accountAEpoch)).toBeNull();
    const accountBEpoch = api.establishGuideQueueAuthority(accountB, clearedEpoch!)!;
    expect(api.establishGuideQueueAuthority(accountA, clearedEpoch!)).toBeNull();
    expect(api.establishGuideQueueAuthority(accountB, clearedEpoch!)).toBeNull();
    expect(api.currentGuideQueueAuthGeneration()).toBe(accountBEpoch);
  });

  it("does not report a worker authority clear when durable shared storage is unavailable", async () => {
    const generation = Date.now() + 10_000;
    const authority = {
      generation,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
    };
    const values = new Map<string, string>([["guide-queue-authority-v2", JSON.stringify(authority)]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => { throw new Error("worker unavailable"); } },
    });

    await expect(clearGuideQueueAuthContext(generation, authority)).resolves.toBeNull();
    expect(JSON.parse(values.get("guide-queue-authority-v2") || "null")).toEqual(authority);
  });

  it("fails closed when the shared authority epoch cannot be persisted", async () => {
    stubGuideAuthIndexedDb();
    vi.stubGlobal("localStorage", undefined);

    await expect(clearGuideQueueAuthContext(currentGuideQueueAuthGeneration())).resolves.toBeNull();
  });

  it("durably clears worker authority without depending on worker message delivery", async () => {
    const generation = Date.now() + 20_000;
    const authority = {
      generation,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
    };
    const workerState = {
      generation,
      authorityId: "authority-a",
      context: { userId: "user-a", businessId: "business-a", accessToken: "secret", credentialId: "credential-a" },
      owner: { userId: "user-a", businessId: "business-a" },
    };
    const values = new Map<string, string>([["guide-queue-authority-v2", JSON.stringify(authority)]]);
    const shared = stubGuideAuthIndexedDb(workerState);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => { throw new Error("worker unavailable"); } },
    });

    const cleared = await clearGuideQueueAuthContext(generation, authority);

    expect(cleared).not.toBeNull();
    expect(shared.state()).toMatchObject({ generation: cleared, context: null, owner: null });
    expect(isCurrentGuideQueueAuthClear(cleared!)).toBe(true);
  });

  it.each(["abort", "error"] as const)("keeps local authority unchanged when the durable IndexedDB transaction %ss", async failure => {
    const generation = Date.now() + 30_000;
    const authority = {
      generation,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
    };
    const values = new Map<string, string>([["guide-queue-authority-v2", JSON.stringify(authority)]]);
    stubGuideAuthIndexedDb(null, { [failure]: true });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    await expect(clearGuideQueueAuthContext(generation, authority)).resolves.toBeNull();
    expect(JSON.parse(values.get("guide-queue-authority-v2") || "null")).toEqual(authority);
  });

  it("refuses to clear a newer IndexedDB authority from an older local snapshot", async () => {
    const generation = Date.now() + 35_000;
    const authority = {
      generation,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
    };
    const newerWorkerAuthority = {
      generation: generation + 1,
      authorityId: "authority-b",
      context: { userId: "user-b", businessId: "business-b", accessToken: "secret-b", credentialId: "credential-b" },
      owner: { userId: "user-b", businessId: "business-b" },
    };
    const values = new Map<string, string>([["guide-queue-authority-v2", JSON.stringify(authority)]]);
    const shared = stubGuideAuthIndexedDb(newerWorkerAuthority);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    await expect(clearGuideQueueAuthContext(generation, authority)).resolves.toBeNull();
    expect(shared.state()).toEqual(newerWorkerAuthority);
    expect(JSON.parse(values.get("guide-queue-authority-v2") || "null")).toEqual(authority);
  });

  it("does not overwrite a newer shared authority after its durable clear commits", async () => {
    const generation = Date.now() + 40_000;
    const authority = {
      generation,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
    };
    const values = new Map<string, string>([["guide-queue-authority-v2", JSON.stringify(authority)]]);
    const shared = stubGuideAuthIndexedDb({
      generation,
      authorityId: "authority-a",
      context: { userId: "user-a", businessId: "business-a", accessToken: "secret", credentialId: "credential-a" },
      owner: { userId: "user-a", businessId: "business-a" },
    }, { defer: true });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ active: { postMessage: vi.fn() } }) },
    });

    const clearing = clearGuideQueueAuthContext(generation, authority);
    const newerAuthority = {
      generation: generation + 100,
      authorityId: "authority-b",
      userId: "user-b",
      businessId: "business-b",
    };
    values.set("guide-queue-authority-v2", JSON.stringify(newerAuthority));
    shared.release();

    await expect(clearing).resolves.toBeNull();
    expect(currentGuideQueueAuthGeneration()).toBe(newerAuthority.generation);
    expect(isCurrentGuideQueueAuthClear(newerAuthority.generation)).toBe(false);
  });

  it("does not expose an activatable clear generation before the worker tombstone commits", async () => {
    const generation = Date.now() + 50_000;
    const authority = {
      generation,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
    };
    const values = new Map<string, string>([["guide-queue-authority-v2", JSON.stringify(authority)]]);
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    const shared = stubGuideAuthIndexedDb({
      generation,
      authorityId: "authority-a",
      context: { userId: "user-a", businessId: "business-a", accessToken: "secret", credentialId: "credential-a" },
      owner: { userId: "user-a", businessId: "business-a" },
    }, { defer: true });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem,
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ active: { postMessage: vi.fn() } }) },
    });

    const clearing = clearGuideQueueAuthContext(generation, authority);
    const exposedGeneration = currentGuideQueueAuthGeneration();
    const accountBGeneration = establishGuideQueueAuthority({
      userId: "user-b", businessId: "business-b", accessToken: "token-b",
    }, exposedGeneration);
    expect(setItem).not.toHaveBeenCalled();
    shared.release();
    const clearedGeneration = await clearing;

    expect(exposedGeneration).toBe(generation);
    expect(accountBGeneration).toBeNull();
    expect(clearedGeneration).not.toBeNull();
    expect(shared.state()).toMatchObject({ generation: clearedGeneration, context: null, owner: null });
    expect(isCurrentGuideQueueAuthClear(clearedGeneration!)).toBe(true);
  });

  it("recovers a durable clear left between the IndexedDB commit and local publication", async () => {
    const generation = Date.now() + 60_000;
    const clearedGeneration = generation + 1;
    const authority = {
      generation,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
    };
    const values = new Map<string, string>([["guide-queue-authority-v2", JSON.stringify(authority)]]);
    stubGuideAuthIndexedDb({
      generation: clearedGeneration,
      authorityId: "durable-clear",
      context: null,
      owner: null,
      clearedFromAuthorityId: "authority-a",
      credentialRevision: null,
      retiredCredentialIds: [],
    });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ active: { postMessage: vi.fn() } }) },
    });

    await expect(clearGuideQueueAuthContext(generation, authority)).resolves.toBe(clearedGeneration);
    expect(JSON.parse(values.get("guide-queue-authority-v2") || "null")).toEqual({
      generation: clearedGeneration,
      authorityId: "durable-clear",
      userId: null,
      businessId: null,
    });
    expect(isCurrentGuideQueueAuthClear(clearedGeneration)).toBe(true);
  });

  it("coalesces two clears of the same authority into one durable transition", async () => {
    const generation = Date.now() + 70_000;
    const authority = {
      generation,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
    };
    const values = new Map<string, string>([["guide-queue-authority-v2", JSON.stringify(authority)]]);
    stubGuideAuthIndexedDb({
      generation,
      authorityId: "authority-a",
      context: { userId: "user-a", businessId: "business-a", accessToken: "secret", credentialId: "credential-a" },
      owner: { userId: "user-a", businessId: "business-a" },
    });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ active: { postMessage: vi.fn() } }) },
    });

    const [first, second] = await Promise.all([
      clearGuideQueueAuthContext(generation, authority),
      clearGuideQueueAuthContext(generation, authority),
    ]);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(isCurrentGuideQueueAuthClear(first!)).toBe(true);
  });

  it("activates a later account only after confirming the durable worker tombstone", async () => {
    const generation = Date.now() + 80_000;
    const clearAuthority = {
      generation,
      authorityId: "durable-clear",
      userId: null,
      businessId: null,
    };
    const values = new Map<string, string>([["guide-queue-authority-v2", JSON.stringify(clearAuthority)]]);
    stubGuideAuthIndexedDb({
      generation,
      authorityId: "durable-clear",
      context: null,
      owner: null,
    });
    const postMessage = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ active: { postMessage } }) },
    });
    const accountB = { userId: "user-b", businessId: "business-b", accessToken: "token-b" };

    const accountBGeneration = await activateGuideQueueAuthContext(accountB, generation);

    expect(accountBGeneration).not.toBeNull();
    expect(currentGuideQueueAuthority()).toEqual(expect.objectContaining({
      generation: accountBGeneration,
      userId: "user-b",
      businessId: "business-b",
    }));
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "GUIDE_AUTH_CONTEXT",
      generation: accountBGeneration,
      context: expect.objectContaining({ userId: "user-b", businessId: "business-b" }),
    }));
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

  it("falls back to an active-worker replay when Background Sync registration rejects", async () => {
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: async () => ({
          sync: { register: vi.fn(async () => { throw new Error("registration denied"); }) },
          active: { postMessage },
        }),
      },
    });

    await expect(registerGuideCheckInSync()).resolves.toBeUndefined();
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
      idbPutIfAbsent: async (db: unknown, item: QueueItem) => { writes.push({ db, item: structuredClone(item) }); return true; },
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

  it("sanitizes legacy work once without overwriting or resurrecting a colliding current record", async () => {
    const legacyDb = { name: "legacy", close: vi.fn() };
    const currentDb = { name: "current", close: vi.fn() };
    let legacyItem = boundItem({ userId: undefined, businessId: undefined, token: "legacy-token" });
    const current = new Map<string, QueueItem>([["event-a", boundItem({ payload: payload("event-a", "current-booking") })]]);
    const currentWrites: QueueItem[] = [];
    const migrate = sourceFunction("public/guide/sw.js", "migrateLegacyQueue", {
      openLegacyDb: async () => legacyDb,
      openDb: async () => currentDb,
      idbGetAll: async (db: unknown) => db === legacyDb ? [structuredClone(legacyItem)] : Array.from(current.values()),
      idbPutIfAbsent: async (_db: unknown, item: QueueItem) => {
        if (current.has(item.id)) return false;
        currentWrites.push(structuredClone(item));
        current.set(item.id, structuredClone(item));
        return true;
      },
      idbPut: async (db: unknown, item: QueueItem) => {
        if (db === legacyDb) legacyItem = structuredClone(item);
        else {
          currentWrites.push(structuredClone(item));
          current.set(item.id, structuredClone(item));
        }
      },
    });

    await migrate();
    expect(current.get("event-a")?.payload.booking_id).toBe("current-booking");
    expect(legacyItem).toMatchObject({ status: "blocked_legacy", lastError: "missing_owner" });
    expect(legacyItem).not.toHaveProperty("token");

    current.delete("event-a");
    await migrate();
    expect(currentWrites).toEqual([]);
    expect(current.has("event-a")).toBe(false);
  });

  it("uses one IndexedDB transaction to preserve a current row during legacy migration", async () => {
    const add = vi.fn();
    const db = { transaction: () => {
      const tx: any = {};
      const store = {
        get: () => {
          const request: any = { result: boundItem({ payload: payload("event-a", "current-booking") }) };
          queueMicrotask(() => {
            request.onsuccess?.();
            queueMicrotask(() => tx.oncomplete?.());
          });
          return request;
        },
        add,
      };
      tx.objectStore = () => store;
      return tx;
    } };
    const putIfAbsent = sourceFunction("public/guide/sw.js", "idbPutIfAbsent", { STORE: "check-ins" });

    await expect(putIfAbsent(db, boundItem({ status: "blocked_legacy" }))).resolves.toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it.each([
    "idbPut",
    "idbDelete",
    "idbPutIfAbsent",
    "idbSetAuthState",
    "idbApplyAuthContext",
    "idbClearAuthIfCredential",
    "idbResolveGuideQueueIssue",
  ])("rejects %s when its IndexedDB transaction aborts", async name => {
    const tx: any = {};
    const db = { transaction: () => {
      queueMicrotask(() => {
        tx.error = new Error("aborted");
        tx.onabort?.();
      });
      return tx;
    } };
    tx.objectStore = () => ({ put: vi.fn(), delete: vi.fn(), add: vi.fn(), get: () => ({}) });
    const helper = sourceFunction("public/guide/sw.js", name, {
      STORE: "check-ins",
      AUTH_STORE: "auth-context",
      AUTH_KEY: "current",
    });
    const work = name === "idbApplyAuthContext"
      ? helper(db, { userId: "user-a", businessId: "business-a", credentialId: "credential-a" }, 10, "authority-a")
      : name === "idbClearAuthIfCredential"
        ? helper(db, 10, "authority-a", "credential-a")
        : name === "idbResolveGuideQueueIssue"
          ? helper(db, { generation: 10, authorityId: "authority-a", userId: "user-a", businessId: "business-a", itemId: "event-a" }, "acknowledge")
          : name === "idbDelete"
            ? helper(db, "event-a")
            : helper(db, boundItem());
    const result = await Promise.race([
      work.then(() => "resolved", () => "rejected"),
      new Promise(resolve => setTimeout(() => resolve("hung"), 25)),
    ]);

    expect(result).toBe("rejected");
  });

  it("rejects app-side queue persistence when IndexedDB aborts", async () => {
    const tx: any = {};
    const db = {
      close: vi.fn(),
      objectStoreNames: { contains: () => true },
      transaction: () => {
        queueMicrotask(() => {
          tx.error = new Error("aborted");
          tx.onabort?.();
        });
        return tx;
      },
    };
    tx.objectStore = () => ({ put: vi.fn() });
    vi.stubGlobal("indexedDB", { open: () => {
      const request: any = { result: db };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } });

    const result = await Promise.race([
      guideOffline.queueGuideCheckIn(boundItem() as any).then(() => "resolved", () => "rejected"),
      new Promise(resolve => setTimeout(() => resolve("hung"), 25)),
    ]);

    expect(result).toBe("rejected");
    expect(db.close).toHaveBeenCalledOnce();
  });

  it("applies only current-or-newer worker auth generations and clears them conditionally", async () => {
    let state: {
      generation: number;
      authorityId: string;
      context: any;
      owner?: { userId: string; businessId: string } | null;
      retiredCredentialIds?: string[];
    } = {
      generation: 10,
      authorityId: "authority-a",
      context: {
        userId: "user-a", businessId: "business-a", accessToken: "token-a", credentialId: "credential-a",
        credentialIssuedAt: 10, credentialExpiresAt: 20,
      },
      owner: { userId: "user-a", businessId: "business-a" },
      retiredCredentialIds: [],
    };
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
    const clear = sourceFunction("public/guide/sw.js", "idbClearAuthIfCredential", authBindings);

    await expect(apply(db, { userId: "user-stale" }, 99)).resolves.toBe(false);
    expect(writes).toEqual([]);
    await expect(apply(db, {
      userId: "user-b", businessId: "business-b", accessToken: "token-b", credentialId: "credential-b",
      credentialIssuedAt: 100, credentialExpiresAt: 200,
    }, 11, "authority-b")).resolves.toBe(true);
    expect(state).toEqual({
      generation: 11,
      authorityId: "authority-b",
      context: {
        userId: "user-b", businessId: "business-b", accessToken: "token-b", credentialId: "credential-b",
        credentialIssuedAt: 100, credentialExpiresAt: 200,
      },
      owner: { userId: "user-b", businessId: "business-b" },
      credentialRevision: { credentialId: "credential-b", credentialIssuedAt: 100, credentialExpiresAt: 200 },
      retiredCredentialIds: [],
    });
    await expect(apply(db, {
      userId: "user-b",
      businessId: "business-b",
      accessToken: "refreshed-token-b",
      credentialId: "credential-b-refreshed",
      credentialIssuedAt: 200,
      credentialExpiresAt: 300,
    }, 11, "authority-b")).resolves.toBe(true);
    await expect(clear(db, 10, "authority-a", "credential-a")).resolves.toBe(false);
    expect(state.context).toMatchObject({ accessToken: "refreshed-token-b", credentialId: "credential-b-refreshed" });
    await expect(clear(db, 11, "authority-b", "credential-b")).resolves.toBe(false);
    expect(state.context).toMatchObject({ accessToken: "refreshed-token-b", credentialId: "credential-b-refreshed" });
    await expect(clear(db, 11, "authority-b", "credential-b-refreshed")).resolves.toBe(true);
    expect(state).toEqual({
      generation: 11,
      authorityId: "authority-b",
      context: null,
      owner: { userId: "user-b", businessId: "business-b" },
      credentialRevision: { credentialId: "credential-b-refreshed", credentialIssuedAt: 200, credentialExpiresAt: 300 },
      retiredCredentialIds: ["credential-b", "credential-b-refreshed"],
    });
    await expect(apply(db, {
      userId: "user-b", businessId: "business-b", accessToken: "token-b", credentialId: "credential-b",
      credentialIssuedAt: 100, credentialExpiresAt: 200,
    }, 11, "authority-b")).resolves.toBe(false);
    await expect(apply(db, {
      userId: "user-b", businessId: "business-b", accessToken: "new-token-b", credentialId: "credential-b-new",
      credentialIssuedAt: 300, credentialExpiresAt: 400,
    }, 11, "authority-b")).resolves.toBe(true);
    expect(state).toEqual({
      generation: 11,
      authorityId: "authority-b",
      context: {
        userId: "user-b", businessId: "business-b", accessToken: "new-token-b", credentialId: "credential-b-new",
        credentialIssuedAt: 300, credentialExpiresAt: 400,
      },
      owner: { userId: "user-b", businessId: "business-b" },
      credentialRevision: { credentialId: "credential-b-new", credentialIssuedAt: 300, credentialExpiresAt: 400 },
      retiredCredentialIds: ["credential-b", "credential-b-refreshed"],
    });
  });

  it("refuses a delayed older credential publication at the same owner authority", async () => {
    let state: any = {
      generation: 10,
      authorityId: "authority-a",
      context: {
        userId: "user-a", businessId: "business-a", accessToken: "initial-token", credentialId: "credential-initial",
        credentialIssuedAt: 100, credentialExpiresAt: 200,
      },
      owner: { userId: "user-a", businessId: "business-a" },
      retiredCredentialIds: [],
    };
    const db = { transaction: () => {
      const tx: any = {};
      const store = {
        get: () => {
          const request: any = { result: structuredClone(state) };
          queueMicrotask(() => { request.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); });
          return request;
        },
        put: (value: unknown) => { state = structuredClone(value); },
      };
      tx.objectStore = () => store;
      return tx;
    } };
    const apply = sourceFunction("public/guide/sw.js", "idbApplyAuthContext", {
      AUTH_STORE: "auth-context",
      AUTH_KEY: "current",
    });
    const applyAfterWorkerRestart = sourceFunction("public/guide/sw.js", "idbApplyAuthContext", {
      AUTH_STORE: "auth-context",
      AUTH_KEY: "current",
    });
    const newer = {
      userId: "user-a", businessId: "business-a", accessToken: "new-token", credentialId: "credential-new",
      credentialIssuedAt: 300, credentialExpiresAt: 400,
    };
    const older = {
      userId: "user-a", businessId: "business-a", accessToken: "old-token", credentialId: "credential-old",
      credentialIssuedAt: 200, credentialExpiresAt: 300,
    };

    await expect(apply(db, newer, 10, "authority-a")).resolves.toBe(true);
    await expect(applyAfterWorkerRestart(db, older, 10, "authority-a")).resolves.toBe(false);
    await expect(apply(db, { ...newer, credentialIssuedAt: 0, credentialExpiresAt: 0 }, 10, "authority-a")).resolves.toBe(false);
    await expect(apply(db, newer, 10, "authority-a")).resolves.toBe(true);
    expect(state.context).toEqual(newer);
    expect(state.retiredCredentialIds).not.toContain("credential-new");
  });

  it("fails closed for unordered equal-generation credentials and bounds retired metadata", async () => {
    let state: any = {
      generation: 10,
      authorityId: "authority-a",
      context: {
        userId: "user-a", businessId: "business-a", accessToken: "token-0", credentialId: "credential-0",
        credentialIssuedAt: 100, credentialExpiresAt: 200,
      },
      owner: { userId: "user-a", businessId: "business-a" },
      retiredCredentialIds: [],
    };
    const db = { transaction: () => {
      const tx: any = {};
      const store = {
        get: () => {
          const request: any = { result: structuredClone(state) };
          queueMicrotask(() => { request.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); });
          return request;
        },
        put: (value: unknown) => { state = structuredClone(value); },
      };
      tx.objectStore = () => store;
      return tx;
    } };
    const apply = sourceFunction("public/guide/sw.js", "idbApplyAuthContext", {
      AUTH_STORE: "auth-context",
      AUTH_KEY: "current",
    });

    await expect(apply(db, {
      userId: "user-a", businessId: "business-a", accessToken: "unordered", credentialId: "credential-unordered",
      credentialIssuedAt: 0, credentialExpiresAt: 0,
    }, 10, "authority-a")).resolves.toBe(false);
    await expect(apply(db, {
      userId: "user-a", businessId: "business-a", accessToken: "same-time", credentialId: "credential-same-time",
      credentialIssuedAt: 100, credentialExpiresAt: 200,
    }, 10, "authority-a")).resolves.toBe(false);
    for (let index = 1; index <= 20; index += 1) {
      await expect(apply(db, {
        userId: "user-a", businessId: "business-a", accessToken: `token-${index}`, credentialId: `credential-${index}`,
        credentialIssuedAt: 100 + index, credentialExpiresAt: 200 + index,
      }, 10, "authority-a")).resolves.toBe(true);
    }
    expect(state.context.credentialId).toBe("credential-20");
    expect(state.retiredCredentialIds.length).toBeLessThanOrEqual(8);
    await expect(apply(db, {
      userId: "user-a", businessId: "business-a", accessToken: "token-1", credentialId: "credential-1",
      credentialIssuedAt: 101, credentialExpiresAt: 201,
    }, 10, "authority-a")).resolves.toBe(false);
  });

  it("deletes only canonical success and uses current bound authority", async () => {
    const f = syncFixture({ item: boundItem({ token: "stale-token" }) });
    await f.sync();

    expect(f.deleted).toEqual(["event-a"]);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    const [, init] = f.fetchImpl.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer current-token");
    expect((init?.headers as Record<string, string>)["x-admin-business-id"]).toBe("business-a");
    expect(JSON.parse(String(init?.body))).toEqual(payload());
  });

  it("retains a non-canonical 2xx response as retryable uncertainty", async () => {
    const f = syncFixture({ responseBody: { ok: false, error: "not complete" } });
    await expect(f.sync()).rejects.toThrow("Guide check-in sync remains retryable");

    expect(f.deleted).toEqual([]);
    expect(f.stored.get("event-a")).toMatchObject({ status: "pending", lastError: "uncertain_success", attempts: 1 });
  });

  it("retains a lost successful response body for idempotent replay", async () => {
    const f = syncFixture({ responseBodyError: true });
    await expect(f.sync()).rejects.toThrow("Guide check-in sync remains retryable");

    expect(f.deleted).toEqual([]);
    expect(f.stored.get("event-a")).toMatchObject({ status: "pending", lastError: "uncertain_success", attempts: 1 });
  });

  it("publishes the canonical booking and slot outcome before clearing replayed work", async () => {
    const f = syncFixture();
    await f.sync();

    expect(f.statuses[0]?.[1]).toMatchObject({
      updates: [{
        kind: "canonical",
        id: "event-a",
        userId: "user-a",
        businessId: "business-a",
        bookingId: "booking-a",
        slotId: "slot-a",
        canonical: expect.objectContaining({ ok: true, arrived_count: 4, qty: 4, checked_in: true }),
      }],
    });
  });

  it.each([
    { label: "another account", userId: "user-b", businessId: "business-b" },
    { label: "the same owner after relogin", userId: "user-a", businessId: "business-a" },
  ])("never rewraps an old request outcome in $label authority", async nextOwner => {
    let rows = [boundItem()];
    let authState: any = {
      generation: 10,
      authorityId: "authority-a",
      context: { userId: "user-a", businessId: "business-a", accessToken: "token-a", credentialId: "credential-a" },
      owner: { userId: "user-a", businessId: "business-a" },
    };
    let releaseResponse!: () => void;
    let requestStarted!: () => void;
    const responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
    const entered = new Promise<void>(resolve => { requestStarted = resolve; });
    const messages: Record<string, unknown>[] = [];
    const db = { close: vi.fn() };
    const postQueueStatus = sourceFunction("public/guide/sw.js", "postQueueStatus", {
      ...workerRetryBindings(),
      idbGetAll: async () => structuredClone(rows),
      idbGetAuthState: async () => structuredClone(authState),
      self: { clients: { matchAll: async () => [{ postMessage: (message: Record<string, unknown>) => messages.push(message) }] } },
    });
    const sync = sourceFunction("public/guide/sw.js", "syncCheckIns", {
      ...workerRetryBindings(),
      MAX_SYNC_ITEMS: 25,
      syncFlight: null,
      openDb: async () => db,
      idbGetAll: async () => structuredClone(rows),
      idbGetAuthState: async () => structuredClone(authState),
      idbDelete: async () => { rows = []; },
      idbPut: vi.fn(),
      idbClearAuthIfCredential: vi.fn(),
      postQueueStatus,
      registerCheckInSync: async () => true,
      canonicalCheckInResponse: sourceFunction("public/guide/sw.js", "canonicalCheckInResponse", {}),
      fetch: async () => {
        requestStarted();
        await responseGate;
        return Response.json({
          ok: true, replay: false, qty: 4, arrived_count: 4, checked_in: true,
          checked_in_at: "2026-09-20T08:00:00.000Z", slot_id: "slot-a",
        });
      },
    });

    const work = sync();
    await entered;
    const nextAuthority = {
      generation: 12,
      authorityId: "authority-next",
      userId: nextOwner.userId,
      businessId: nextOwner.businessId,
    };
    authState = {
      ...nextAuthority,
      context: { ...nextAuthority, accessToken: "token-next", credentialId: "credential-next" },
      owner: { userId: nextAuthority.userId, businessId: nextAuthority.businessId },
    };
    releaseResponse();
    await work;

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ...nextAuthority, progressed: 0 });
    expect(messages[0]).not.toHaveProperty("updates");
    const handler = guideStatusHandlerFixture(nextAuthority);
    handler.receive(messages[0]);
    handler.cleanup();
    expect(handler.retries.current).toBe(3);
    expect(handler.dispatched).toEqual([]);
  });

  it("retains a 401, requests reauthentication, and clears the rejected authority", async () => {
    const f = syncFixture({ response: 401 });
    await f.sync();

    expect(f.stored.get("event-a")).toMatchObject({ status: "needs_reauth", lastError: "unauthorized", attempts: 1 });
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

  it("keeps a refreshed token when the request made with its predecessor returns 401", async () => {
    let publishRefresh = () => {};
    const f = syncFixture({
      response: async () => {
        publishRefresh();
        return 401;
      },
    });
    publishRefresh = () => f.setAuth({
      userId: "user-a",
      businessId: "business-a",
      accessToken: "refreshed-token",
    });

    await expect(f.sync()).rejects.toThrow("Guide check-in sync remains retryable");

    expect(f.authState().context).toMatchObject({ accessToken: "refreshed-token" });
    expect(f.stored.get("event-a")).toMatchObject({ status: "pending", lastError: "auth_changed" });
  });

  it("parses Retry-After seconds and dates with safe fallback and clamping", () => {
    const retryDelayMs = sourceFunction("public/guide/sw.js", "retryDelayMs", {
      BASE_RETRY_DELAY_MS: 5_000,
      MAX_RETRY_DELAY_MS: 15 * 60_000,
    });
    const now = Date.parse("2026-09-20T10:00:00.000Z");

    expect(retryDelayMs(1, "12", now)).toBe(12_000);
    expect(retryDelayMs(1, "Sun, 20 Sep 2026 10:02:00 GMT", now)).toBe(120_000);
    expect(retryDelayMs(1, "not-a-delay", now)).toBe(5_000);
    expect(retryDelayMs(1, "999999", now)).toBe(15 * 60_000);
  });

  it("exhausts retryable work after five automatic attempts while preserving its event", () => {
    const retryQueueItem = sourceFunction("public/guide/sw.js", "retryQueueItem", {
      MAX_AUTO_ATTEMPTS: 5,
      BASE_RETRY_DELAY_MS: 5_000,
      MAX_RETRY_DELAY_MS: 15 * 60_000,
      retryDelayMs: sourceFunction("public/guide/sw.js", "retryDelayMs", {
        BASE_RETRY_DELAY_MS: 5_000,
        MAX_RETRY_DELAY_MS: 15 * 60_000,
      }),
    });
    const now = 1_000_000;

    expect(retryQueueItem(boundItem({ attempts: 0 }), "network", null, now)).toMatchObject({
      id: "event-a", status: "pending", attempts: 1, nextAttemptAt: now + 5_000, lastError: "network",
    });
    const exhausted = retryQueueItem(boundItem({ attempts: 4 }), "http_503", null, now);
    expect(exhausted).toMatchObject({
      id: "event-a", status: "retry_exhausted", attempts: 5, lastError: "http_503",
    });
    expect(exhausted).not.toHaveProperty("nextAttemptAt");
  });

  for (const response of [429, 500, "network"] as const) {
    it(`retains retryable ${response} work and rejects the sync for browser retry`, async () => {
      const f = syncFixture({ response });
      await expect(f.sync()).rejects.toThrow("Guide check-in sync remains retryable");

      expect(f.stored.get("event-a")).toMatchObject({ status: "pending", attempts: 1 });
      expect(f.deleted).toEqual([]);
    });
  }

  it("persists a clamped Retry-After delay for 429 work", async () => {
    const before = Date.now();
    const f = syncFixture({ response: 429, responseHeaders: { "Retry-After": "12" } });

    await expect(f.sync()).rejects.toThrow("Guide check-in sync remains retryable");

    expect(f.stored.get("event-a")).toMatchObject({ status: "pending", attempts: 1 });
    expect(f.stored.get("event-a")?.nextAttemptAt).toBeGreaterThanOrEqual(before + 12_000);
  });

  it("skips not-yet-due work without consuming the batch and still serves later due work", async () => {
    const future = boundItem({
      id: "future", payload: payload("future"), queuedAt: 1, nextAttemptAt: Date.now() + 60_000,
    });
    const due = boundItem({ id: "due", payload: payload("due"), queuedAt: 2 });
    const f = syncFixture({ items: [future, due] });

    await f.sync();

    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(String(f.fetchImpl.mock.calls[0][1]?.body)).client_event_id).toBe("due");
    expect(f.stored.has("future")).toBe(true);
    expect(f.stored.has("due")).toBe(false);
  });

  it("preserves retry due time across a new sync invocation", async () => {
    const f = syncFixture({ response: 503 });

    await expect(f.sync()).rejects.toThrow("Guide check-in sync remains retryable");
    const scheduled = f.stored.get("event-a")?.nextAttemptAt;
    expect(scheduled).toBeGreaterThan(Date.now());
    await expect(f.sync()).resolves.toBeUndefined();
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(f.stored.get("event-a")?.nextAttemptAt).toBe(scheduled);
  });

  it("pauses retryable work at the automatic-attempt cap instead of looping forever", async () => {
    const f = syncFixture({ item: boundItem({ attempts: 4 }), response: "network" });

    await expect(f.sync()).resolves.toBeUndefined();
    await expect(f.sync()).resolves.toBeUndefined();

    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(f.stored.get("event-a")).toMatchObject({
      id: "event-a", status: "retry_exhausted", attempts: 5, lastError: "network",
    });
  });

  it("quarantines legacy over-budget pending rows without another request", async () => {
    const f = syncFixture({ item: boundItem({ attempts: 100_000 }), response: 503 });

    await expect(f.sync()).resolves.toBeUndefined();
    await expect(f.sync()).resolves.toBeUndefined();

    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.stored.get("event-a")).toMatchObject({ status: "retry_exhausted", attempts: 100_000 });
  });

  it.each([409, 422])("retains terminal HTTP %i rejection with a visible failed state", async response => {
    const f = syncFixture({ response });
    await f.sync();

    expect(f.stored.get("event-a")).toMatchObject({ status: "failed", lastError: `http_${response}`, attempts: 1 });
    expect(f.deleted).toEqual([]);
    expect(f.statuses.length).toBeGreaterThan(0);
  });

  it.each([
    { userId: "user-b", businessId: "business-a", accessToken: "other-token" },
    { userId: "user-a", businessId: "business-b", accessToken: "other-token" },
  ])("never submits work under mismatched $userId/$businessId authority", async auth => {
    const f = syncFixture({ auth });
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

  it("does not let retained terminal rows consume the bounded replay batch", async () => {
    const terminal = Array.from({ length: 25 }, (_, index) => boundItem({ id: `failed-${index}`, payload: payload(`failed-${index}`), status: "failed" }));
    const valid = boundItem({ id: "valid-later", payload: payload("valid-later") });
    const f = syncFixture({ items: [...terminal, valid] });

    await f.sync();

    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(f.deleted).toEqual(["valid-later"]);
  });

  it("moves a retryable oldest item behind untouched work so later items are not starved", async () => {
    const old = boundItem({ id: "old-retry", payload: payload("old-retry"), queuedAt: 1 });
    const later = boundItem({ id: "later", payload: payload("later"), queuedAt: 2 });
    const f = syncFixture({
      items: [old, later],
      maxItems: 1,
      response: item => item.id === "old-retry" ? 500 : 200,
    });

    await expect(f.sync()).rejects.toThrow("Guide check-in sync remains retryable");
    await f.sync();

    expect(f.fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).client_event_id)).toEqual(["old-retry", "later"]);
    expect(f.deleted).toContain("later");
    expect(f.stored.has("old-retry")).toBe(true);
  });

  it("serializes overlapping sync requests so a late failure cannot resurrect completed work", async () => {
    let releaseFirst!: () => void;
    const firstResponse = new Promise<void>(resolve => { releaseFirst = resolve; });
    let attempts = 0;
    const f = syncFixture({
      response: async () => {
        attempts += 1;
        if (attempts === 1) {
          await firstResponse;
          return 500;
        }
        return 200;
      },
    });

    const first = f.sync();
    const overlapping = f.sync();
    await vi.waitFor(() => expect(attempts).toBeGreaterThan(0));
    const attemptsBeforeRelease = attempts;
    releaseFirst();
    await Promise.allSettled([first, overlapping]);

    expect(attemptsBeforeRelease).toBe(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.stored.get("event-a")).toMatchObject({ status: "pending", lastError: "http_500" });

    f.stored.set("event-a", { ...f.stored.get("event-a")!, nextAttemptAt: 0 });
    await f.sync();
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    expect(f.stored.has("event-a")).toBe(false);
  });

  it("reports progress and drains a queue larger than the bounded batch across continuations", async () => {
    const items = Array.from({ length: 126 }, (_, index) => boundItem({ id: `event-${index}`, payload: payload(`event-${index}`), queuedAt: index }));
    const f = syncFixture({ items });

    for (let batch = 0; batch < 6; batch += 1) await f.sync();

    expect(f.fetchImpl).toHaveBeenCalledTimes(126);
    expect(f.stored.size).toBe(0);
    expect(f.registered()).toBe(5);
    expect(f.statuses.slice(0, 5).every(args => (args[1] as any)?.progressed === 25 && (args[1] as any)?.deferred === true)).toBe(true);
    expect(f.statuses[5]?.[1]).toMatchObject({ progressed: 1, deferred: false });
  });

  it("rejects a deferred batch when worker Background Sync registration cannot preserve its continuation", async () => {
    const items = Array.from({ length: 26 }, (_, index) => boundItem({
      id: `event-${index}`,
      payload: payload(`event-${index}`),
      queuedAt: index,
    }));
    const f = syncFixture({ items, registerResult: false });

    await expect(f.sync()).rejects.toThrow("Guide check-in sync remains retryable");

    expect(f.fetchImpl).toHaveBeenCalledTimes(25);
    expect(f.stored.size).toBe(1);
    expect(f.registered()).toBe(1);
    expect(f.statuses[0]?.[1]).toMatchObject({ progressed: 25, deferred: true });

    await f.sync();
    expect(f.fetchImpl).toHaveBeenCalledTimes(26);
    expect(f.stored.size).toBe(0);
  });

  it("publishes durable pending, reauth, failed, and blocked counts", async () => {
    const postMessage = vi.fn();
    const status = sourceFunction("public/guide/sw.js", "postQueueStatus", {
      ...workerRetryBindings(),
      idbGetAll: async () => [
        boundItem(),
        boundItem({ id: "reauth", status: "needs_reauth" }),
        boundItem({ id: "failed", status: "failed" }),
        boundItem({ id: "blocked", status: "blocked_account" }),
        boundItem({ id: "foreign", userId: "user-b", status: "failed" }),
      ],
      idbGetAuthState: async () => ({
        generation: 10,
        authorityId: "authority-a",
        context: { userId: "user-a", businessId: "business-a", accessToken: "token-a" },
      }),
      self: { clients: { matchAll: async () => [{ postMessage }] } },
    });

    await status({}, { progressed: 2, deferred: true });

    expect(postMessage).toHaveBeenCalledWith({
      type: "GUIDE_QUEUE_STATUS",
      generation: 10,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
      counts: { pending: 1, needsReauth: 1, failed: 1, blocked: 1, exhausted: 0 },
      progressed: 2,
      deferred: true,
      autoRetriesRemaining: 5,
      nextAttemptAt: null,
      issues: [{
        id: "failed",
        userId: "user-a",
        businessId: "business-a",
        bookingId: "booking-a",
        slotId: "slot-a",
        reason: "rejected",
      }],
    });
  });

  it("keeps reauthentication work visible after dropping only the rejected bearer context", async () => {
    const postMessage = vi.fn();
    const status = sourceFunction("public/guide/sw.js", "postQueueStatus", {
      ...workerRetryBindings(),
      idbGetAll: async () => [
        boundItem({ id: "reauth", status: "needs_reauth" }),
        boundItem({ id: "foreign", userId: "user-b", status: "needs_reauth" }),
      ],
      idbGetAuthState: async () => ({
        generation: 10,
        authorityId: "authority-a",
        context: null,
        owner: { userId: "user-a", businessId: "business-a" },
      }),
      self: { clients: { matchAll: async () => [{ postMessage }] } },
    });

    await status({});

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      generation: 10,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
      counts: { pending: 0, needsReauth: 1, failed: 0, blocked: 0, exhausted: 0 },
    }));
  });

  it("publishes owner-scoped exhausted work and the earliest pending retry time", async () => {
    const postMessage = vi.fn();
    const later = Date.now() + 60_000;
    const earlier = Date.now() + 30_000;
    const status = sourceFunction("public/guide/sw.js", "postQueueStatus", {
      ...workerRetryBindings(),
      idbGetAll: async () => [
        boundItem({ id: "later", payload: payload("later"), attempts: 4, nextAttemptAt: later }),
        boundItem({ id: "earlier", payload: payload("earlier"), attempts: 3, nextAttemptAt: earlier }),
        boundItem({ id: "exhausted", payload: payload("exhausted"), status: "retry_exhausted", attempts: 5, lastError: "network" }),
        boundItem({ id: "foreign", payload: payload("foreign"), userId: "user-b", status: "retry_exhausted", attempts: 5 }),
      ],
      idbGetAuthState: async () => ({
        generation: 10,
        authorityId: "authority-a",
        context: { userId: "user-a", businessId: "business-a", accessToken: "token-a" },
      }),
      self: { clients: { matchAll: async () => [{ postMessage }] } },
    });

    await status({});

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      counts: { pending: 2, needsReauth: 0, failed: 0, blocked: 0, exhausted: 1 },
      autoRetriesRemaining: 2,
      nextAttemptAt: earlier,
      issues: [expect.objectContaining({
        id: "exhausted",
        userId: "user-a",
        businessId: "business-a",
        reason: "network",
        retryable: true,
      })],
    }));
  });

  it("rejects a delayed status envelope after logout, account switch, or relogin", () => {
    const matches = sourceFunction("components/GuideServiceWorker.tsx", "isCurrentGuideQueueStatus", {});
    const accountA = {
      generation: 10,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
    };
    const accountB = {
      generation: 11,
      authorityId: "authority-b",
      userId: "user-b",
      businessId: "business-b",
    };
    const reloggedA = { ...accountA, generation: 12, authorityId: "authority-a-new" };
    const envelopeA = { type: "GUIDE_QUEUE_STATUS", ...accountA, progressed: 25, counts: { pending: 0 } };

    expect(matches(envelopeA, accountA, "business-a")).toBe(true);
    expect(matches(envelopeA, accountB, "business-b")).toBe(false);
    expect(matches(envelopeA, reloggedA, "business-a")).toBe(false);
    expect(matches(envelopeA, null, "")).toBe(false);
  });

  it("rejects a stale status envelope before applying progress, counts, issues, or updates", () => {
    const source = readFileSync("components/GuideServiceWorker.tsx", "utf8");
    const handler = source.slice(source.indexOf("const onMessage"), source.indexOf("const onOnline"));
    const guard = handler.indexOf("isCurrentGuideQueueStatus(event.data, authority, businessId)");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(handler.indexOf("const counts"));
    expect(guard).toBeLessThan(handler.indexOf("setStatus({"));
  });

  it("validates authority, owner, status, and acknowledgement delete in one IndexedDB transaction", async () => {
    const transactions: Array<{ stores: string[]; mode: string }> = [];
    const deleted: string[] = [];
    const db = { transaction: (stores: string[], mode: string) => {
      transactions.push({ stores: [...stores], mode });
      const tx: any = {};
      let completed = false;
      const complete = () => queueMicrotask(() => {
        if (completed) return;
        completed = true;
        tx.oncomplete?.();
      });
      tx.objectStore = (name: string) => ({
        get: () => {
          const request: any = {
            result: name === "auth-context"
              ? { generation: 10, authorityId: "authority-a", context: { userId: "user-a", businessId: "business-a" } }
              : boundItem({ status: "failed" }),
          };
          queueMicrotask(() => { request.onsuccess?.(); complete(); });
          return request;
        },
        delete: (id: string) => { deleted.push(id); },
        put: vi.fn(),
      });
      return tx;
    } };
    const mutate = sourceFunction("public/guide/sw.js", "idbResolveGuideQueueIssue", {
      AUTH_STORE: "auth-context",
      AUTH_KEY: "current",
      STORE: "check-ins",
    });

    await expect(mutate(db, { ...({ generation: 10, authorityId: "authority-a", userId: "user-a", businessId: "business-a" }), itemId: "event-a" }, "acknowledge"))
      .resolves.toBe(true);

    expect(transactions).toEqual([{ stores: ["auth-context", "check-ins"], mode: "readwrite" }]);
    expect(deleted).toEqual(["event-a"]);
  });

  it("routes acknowledgement through the atomic owner transaction and posts status only after success", async () => {
    const order: string[] = [];
    const acknowledge = sourceFunction("public/guide/sw.js", "acknowledgeGuideQueueIssue", {
      openDb: async () => ({ close: () => order.push("close") }),
      idbResolveGuideQueueIssue: async () => { order.push("atomic commit"); return true; },
      idbGetAuthState: async () => { throw new Error("split auth read"); },
      idbGet: async () => { throw new Error("split item read"); },
      idbDelete: async () => { throw new Error("split delete"); },
      postQueueStatus: async () => { order.push("status"); },
    });

    await expect(acknowledge({
      generation: 10, authorityId: "authority-a", userId: "user-a", businessId: "business-a", itemId: "event-a",
    })).resolves.toBe(true);
    expect(order).toEqual(["atomic commit", "status", "close"]);
  });

  it("atomically resets an exhausted current-owner item without changing its stable event", async () => {
    const writes: QueueItem[] = [];
    let authState = { generation: 10, authorityId: "authority-a", context: { userId: "user-a", businessId: "business-a" } };
    const db = { transaction: () => {
      const tx: any = {};
      let completed = false;
      const complete = () => queueMicrotask(() => {
        if (completed) return;
        completed = true;
        tx.oncomplete?.();
      });
      tx.objectStore = (name: string) => ({
        get: () => {
          const request: any = {
            result: name === "auth-context"
              ? structuredClone(authState)
              : boundItem({ status: "retry_exhausted", attempts: 5, lastError: "network", nextAttemptAt: 99_999 }),
          };
          queueMicrotask(() => { request.onsuccess?.(); complete(); });
          return request;
        },
        delete: vi.fn(),
        put: (value: QueueItem) => writes.push(structuredClone(value)),
      });
      return tx;
    } };
    const mutate = sourceFunction("public/guide/sw.js", "idbResolveGuideQueueIssue", {
      AUTH_STORE: "auth-context",
      AUTH_KEY: "current",
      STORE: "check-ins",
    });
    const message = {
      generation: 10, authorityId: "authority-a", userId: "user-a", businessId: "business-a", itemId: "event-a",
    };

    await expect(mutate(db, message, "retry")).resolves.toBe(true);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      id: "event-a",
      payload: expect.objectContaining({ client_event_id: "event-a" }),
      userId: "user-a",
      businessId: "business-a",
      status: "pending",
      attempts: 0,
    });
    expect(writes[0]).not.toHaveProperty("nextAttemptAt");

    authState = { generation: 11, authorityId: "authority-b", context: { userId: "user-b", businessId: "business-b" } };
    await expect(mutate(db, message, "retry")).resolves.toBe(false);
    expect(writes).toHaveLength(1);
  });

  it("deletes a terminal issue only after explicit acknowledgement by its current owner", async () => {
    const stored = new Map<string, QueueItem>([
      ["matching", boundItem({ id: "matching", payload: payload("matching", "booking-a"), status: "failed" })],
      ["pending", boundItem({ id: "pending", payload: payload("pending", "booking-a"), status: "pending" })],
      ["other-owner", boundItem({ id: "other-owner", payload: payload("other-owner", "booking-a"), userId: "user-b", status: "failed" })],
      ["legacy", boundItem({ id: "legacy", payload: payload("legacy", "booking-a"), userId: undefined, businessId: undefined, status: "blocked_legacy" })],
    ]);
    const db = { close: vi.fn() };
    const acknowledge = sourceFunction("public/guide/sw.js", "acknowledgeGuideQueueIssue", {
      openDb: async () => db,
      idbResolveGuideQueueIssue: async (_db: unknown, message: { itemId: string; userId: string; businessId: string }, action: string) => {
        const entry = stored.get(message.itemId);
        if (action !== "acknowledge" || !entry || entry.status !== "failed"
            || entry.userId !== message.userId || entry.businessId !== message.businessId
            || message.userId !== "user-a" || message.businessId !== "business-a") return false;
        stored.delete(message.itemId);
        return true;
      },
      idbGet: async (_db: unknown, id: string) => stored.get(id),
      idbGetAuthState: async () => ({
        generation: 20,
        authorityId: "authority-a",
        context: { userId: "user-a", businessId: "business-a", accessToken: "token-a" },
      }),
      idbDelete: async (_db: unknown, id: string) => { stored.delete(id); },
      postQueueStatus: async () => {},
    });

    await expect(acknowledge({
      generation: 20,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
      itemId: "matching",
    })).resolves.toBe(true);
    await expect(acknowledge({
      generation: 20,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
      itemId: "other-owner",
    })).resolves.toBe(false);
    await expect(acknowledge({
      generation: 20,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
      itemId: "pending",
    })).resolves.toBe(false);

    expect(Array.from(stored.keys()).sort()).toEqual(["legacy", "other-owner", "pending"]);
    expect(db.close).toHaveBeenCalledTimes(3);
  });
});

describe("guide authority lifecycle", () => {
  it("uses a distinct cancellable application Web Lock and fails closed without it", async () => {
    const api = guideOffline as unknown as {
      withGuideAuthTransitionLock<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    };
    expect(typeof api.withGuideAuthTransitionLock).toBe("function");

    const work = vi.fn(async () => "done");
    vi.stubGlobal("navigator", {});
    await expect(api.withGuideAuthTransitionLock(work)).rejects.toThrow(/Web Locks/);
    expect(work).not.toHaveBeenCalled();

    const abort = new AbortController();
    const request = vi.fn((_name: string, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("navigator", { locks: { request } });
    const waiting = api.withGuideAuthTransitionLock(work, abort.signal);
    abort.abort();

    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledWith(
      "bookingtours-guide-auth-transition-v1",
      expect.objectContaining({ mode: "exclusive", signal: abort.signal }),
      expect.any(Function),
    );
    expect(work).not.toHaveBeenCalled();
  });

  it("recognizes same-session token refresh without accepting a different login session", () => {
    const api = guideOffline as unknown as {
      sameGuideAuthSession(left: any, right: any): boolean;
    };
    expect(typeof api.sameGuideAuthSession).toBe("function");
    const token = (sessionId: string, issuedAt: number) =>
      `header.${Buffer.from(JSON.stringify({ session_id: sessionId, iat: issuedAt, exp: issuedAt + 100 })).toString("base64url")}.signature`;
    const original = { access_token: token("session-a", 100), user: { id: "user-a" } };
    const refreshed = { access_token: token("session-a", 200), user: { id: "user-a" } };
    const relogged = { access_token: token("session-b", 300), user: { id: "user-a" } };

    expect(api.sameGuideAuthSession(original, refreshed)).toBe(true);
    expect(api.sameGuideAuthSession(original, relogged)).toBe(false);
    expect(api.sameGuideAuthSession(original, null)).toBe(false);
    expect(api.sameGuideAuthSession(null, null)).toBe(true);
  });

  it("rebinds persisted guide authority before a central operator switch", async () => {
    const order: string[] = [];
    const activateGuideQueueAuthContext = vi.fn(async () => { order.push("authority"); return 11; });
    const switchOperator = sourceFunction("components/AuthGate.tsx", "switchOperator", {
      businessId: "business-a",
      operators: [{ id: "business-b", name: "B", logoUrl: "b.png", timezone: "Africa/Johannesburg", subscriptionStatus: "ACTIVE", yocoTestMode: false }],
      guideAuthorityEpochRef: { current: 10 },
      authSessionRef: { current: { access_token: "token-a", user: { id: "user-a" } } },
      authTransitionAbortRef: { current: { signal: new AbortController().signal } },
      withGuideAuthTransitionLock: async (work: () => Promise<unknown>) => work(),
      sameGuideAuthSession,
      currentGuideQueueAuthority: () => ({ generation: 10, authorityId: "authority-a", userId: "user-a", businessId: "business-a" }),
      supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "token-a", user: { id: "user-a" } } } }) } },
      guideQueueAuthContext,
      activateGuideQueueAuthContext,
      contextRequestRef: { current: 0 },
      localStorage: { setItem: vi.fn() },
      setBusinessId: () => order.push("selection"),
      setBusinessName: vi.fn(), setLogoUrl: vi.fn(), setTimezone: vi.fn(),
      setSubscriptionStatus: vi.fn(), setYocoTestMode: vi.fn(),
      setError: vi.fn(),
    });

    await switchOperator("business-b");

    expect(activateGuideQueueAuthContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-a", businessId: "business-b" }),
      10,
      expect.any(Function),
    );
    expect(order).toEqual(["authority", "selection"]);
  });

  it("clears guide authority before central sign-out", async () => {
    const order: string[] = [];
    const clearGuideQueueAuthContext = vi.fn(async () => { order.push("guide-clear"); return 21; });
    const clearSession = sourceFunction("components/AuthGate.tsx", "clearSession", {
      contextRequestRef: { current: 0 },
      guideAuthorityEpochRef: { current: 10 },
      authSessionRef: { current: null },
      authTransitionAbortRef: { current: { signal: new AbortController().signal } },
      withGuideAuthTransitionLock: async (work: () => Promise<unknown>) => work(),
      currentGuideQueueAuthGeneration: () => 20,
      currentGuideQueueAuthority: () => null,
      isCurrentGuideQueueAuthClear: () => true,
      clearGuideQueueAuthContext,
      sameGuideAuthSession,
      supabase: { auth: {
        getSession: async () => ({ data: { session: null } }),
        signOut: async () => { order.push("sign-out"); },
      } },
      localStorage: { removeItem: vi.fn() },
      document: { cookie: "" },
      setError: vi.fn(),
      setAuthed: vi.fn(), setBusinessId: vi.fn(), setBusinessName: vi.fn(), setLogoUrl: vi.fn(),
      setTimezone: vi.fn(), setRole: vi.fn(), setOperators: vi.fn(), setSubscriptionStatus: vi.fn(),
      setYocoTestMode: vi.fn(), setReadOnly: vi.fn(), setHostMismatch: vi.fn(),
    });

    await clearSession();

    expect(clearGuideQueueAuthContext).toHaveBeenCalledWith(20);
    expect(order).toEqual(["guide-clear", "sign-out"]);
  });

  it("does not sign out a newer account established while durable worker clear is pending", async () => {
    let releaseClear: ((generation: number) => void) | undefined;
    const clearGuideQueueAuthContext = vi.fn(() => new Promise<number | null>(resolve => { releaseClear = resolve; }));
    const signOut = vi.fn(async () => {});
    const removeItem = vi.fn();
    const isCurrentGuideQueueAuthClear = vi.fn(() => false);
    const clearSession = sourceFunction("components/AuthGate.tsx", "clearSession", {
      contextRequestRef: { current: 0 },
      guideAuthorityEpochRef: { current: 20 },
      authSessionRef: { current: null },
      authTransitionAbortRef: { current: { signal: new AbortController().signal } },
      withGuideAuthTransitionLock: async (work: () => Promise<unknown>) => work(),
      currentGuideQueueAuthGeneration: () => 20,
      currentGuideQueueAuthority: () => ({ generation: 20, authorityId: "authority-a", userId: "user-a", businessId: "business-a" }),
      isCurrentGuideQueueAuthClear,
      clearGuideQueueAuthContext,
      sameGuideAuthSession,
      supabase: { auth: {
        getSession: async () => ({ data: { session: { access_token: "token-a", user: { id: "user-a" } } } }),
        signOut,
      } },
      localStorage: { removeItem },
      document: { cookie: "" },
      setError: vi.fn(),
      setAuthed: vi.fn(), setBusinessId: vi.fn(), setBusinessName: vi.fn(), setLogoUrl: vi.fn(),
      setTimezone: vi.fn(), setRole: vi.fn(), setOperators: vi.fn(), setSubscriptionStatus: vi.fn(),
      setYocoTestMode: vi.fn(), setReadOnly: vi.fn(), setHostMismatch: vi.fn(),
    });

    const clearing = clearSession(20, { access_token: "token-a", user: { id: "user-a" } });
    await vi.waitFor(() => expect(clearGuideQueueAuthContext).toHaveBeenCalledOnce());
    releaseClear?.(21);
    await clearing;

    expect(isCurrentGuideQueueAuthClear).toHaveBeenCalledWith(21);
    expect(signOut).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("holds the application auth lock across SDK sign-out so a waiting login remains current", async () => {
    const accountA = { access_token: "token-a", user: { id: "user-a" } };
    const accountB = { access_token: "token-b", user: { id: "user-b" } };
    let currentSession: typeof accountA | typeof accountB | null = accountA;
    let queueCleared = false;
    let releaseSdkSignOut!: () => void;
    let signOutStarted = false;
    const sdkGate = new Promise<void>(resolve => { releaseSdkSignOut = resolve; });
    const withGuideAuthTransitionLock = exclusiveTransitionLock();
    const signOut = vi.fn(async () => {
      signOutStarted = true;
      await sdkGate;
      currentSession = null;
    });
    const removeItem = vi.fn();
    const clearSession = sourceFunction("components/AuthGate.tsx", "clearSession", {
      contextRequestRef: { current: 0 },
      guideAuthorityEpochRef: { current: 20 },
      authSessionRef: { current: accountA },
      authTransitionAbortRef: { current: { signal: new AbortController().signal } },
      currentGuideQueueAuthGeneration: () => 20,
      currentGuideQueueAuthority: () => queueCleared ? null : ({
        generation: 20, authorityId: "authority-a", userId: "user-a", businessId: "business-a",
      }),
      sameGuideAuthSession: (left: typeof currentSession, right: typeof currentSession) =>
        left?.user.id === right?.user.id && left?.access_token === right?.access_token,
      withGuideAuthTransitionLock,
      isCurrentGuideQueueAuthClear: () => queueCleared,
      clearGuideQueueAuthContext: async () => { queueCleared = true; return 21; },
      supabase: {
        auth: {
          getSession: async () => ({ data: { session: currentSession } }),
          signOut,
        },
      },
      localStorage: { removeItem },
      document: { cookie: "" },
      setError: vi.fn(),
      setAuthed: vi.fn(), setBusinessId: vi.fn(), setBusinessName: vi.fn(), setLogoUrl: vi.fn(),
      setTimezone: vi.fn(), setRole: vi.fn(), setOperators: vi.fn(), setSubscriptionStatus: vi.fn(),
      setYocoTestMode: vi.fn(), setReadOnly: vi.fn(), setHostMismatch: vi.fn(),
    });

    const clearing = clearSession(20, accountA);
    await vi.waitFor(() => expect(signOutStarted).toBe(true));
    const loginB = withGuideAuthTransitionLock(async () => {
      currentSession = accountB;
      queueCleared = false;
    });
    await Promise.resolve();
    releaseSdkSignOut();
    await Promise.all([clearing, loginB]);

    expect(currentSession).toEqual(accountB);
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("does not let a stale explicit logout erase a login that wins the application lock", async () => {
    const accountA = { access_token: "token-a", user: { id: "user-a" } };
    const accountB = { access_token: "token-b", user: { id: "user-b" } };
    let currentSession: typeof accountA | typeof accountB | null = accountA;
    let authority = {
      generation: 20, authorityId: "authority-a", userId: "user-a", businessId: "business-a",
    };
    let releaseLogin!: () => void;
    let loginStarted = false;
    const loginGate = new Promise<void>(resolve => { releaseLogin = resolve; });
    const withGuideAuthTransitionLock = exclusiveTransitionLock();
    const signOut = vi.fn(async () => { currentSession = null; });
    const clearGuideQueueAuthContext = vi.fn(async () => 22);
    const clearSession = sourceFunction("components/AuthGate.tsx", "clearSession", {
      contextRequestRef: { current: 0 },
      guideAuthorityEpochRef: { current: 20 },
      authSessionRef: { current: accountA },
      authTransitionAbortRef: { current: { signal: new AbortController().signal } },
      currentGuideQueueAuthGeneration: () => authority.generation,
      currentGuideQueueAuthority: () => authority,
      sameGuideAuthSession,
      withGuideAuthTransitionLock,
      isCurrentGuideQueueAuthClear: () => false,
      clearGuideQueueAuthContext,
      supabase: { auth: {
        getSession: async () => ({ data: { session: currentSession } }),
        signOut,
      } },
      localStorage: { removeItem: vi.fn() },
      document: { cookie: "" },
      setError: vi.fn(),
      setAuthed: vi.fn(), setBusinessId: vi.fn(), setBusinessName: vi.fn(), setLogoUrl: vi.fn(),
      setTimezone: vi.fn(), setRole: vi.fn(), setOperators: vi.fn(), setSubscriptionStatus: vi.fn(),
      setYocoTestMode: vi.fn(), setReadOnly: vi.fn(), setHostMismatch: vi.fn(),
    });

    const loginB = withGuideAuthTransitionLock(async () => {
      loginStarted = true;
      await loginGate;
      currentSession = accountB;
      authority = {
        generation: 21, authorityId: "authority-b", userId: "user-b", businessId: "business-b",
      };
    });
    await vi.waitFor(() => expect(loginStarted).toBe(true));
    const staleLogout = clearSession();
    releaseLogin();
    await Promise.all([loginB, staleLogout]);

    expect(currentSession).toEqual(accountB);
    expect(clearGuideQueueAuthContext).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("retains the SDK session when failed-login cleanup cannot durably revoke worker authority", async () => {
    const f = loginCleanupFixture(null);

    await f.login();

    expect(f.log).toEqual(["clear:1", "authority", "clear:2"]);
    expect(f.authSessionRef.current).toEqual(f.session);
    expect(f.setError).toHaveBeenCalledWith(expect.stringMatching(/revoke|cleanup/i));
  });

  it("signs out only after failed-login cleanup durably revokes its published authority", async () => {
    const f = loginCleanupFixture(13);

    await f.login();

    expect(f.log).toEqual(["clear:1", "authority", "clear:2", "signOut"]);
    expect(f.authSessionRef.current).toBeNull();
  });

  it("reports a network auth throttle without counting it as a bad password", async () => {
    const f = loginCleanupFixture(13, { status: 429, message: "Request rate limit reached" });

    await f.login();

    expect(f.setError).toHaveBeenCalledWith(expect.stringMatching(/network.*wait/i));
    expect(f.setItem).not.toHaveBeenCalledWith("ck_fail_count", expect.anything());
    expect(f.authSessionRef.current).toBeNull();
  });

  it("does not sign out or erase a newer shared session when stale validation loses authority", async () => {
    const signOut = vi.fn(async () => {});
    const removeItem = vi.fn();
    const clearSession = sourceFunction("components/AuthGate.tsx", "clearSession", {
      contextRequestRef: { current: 0 },
      guideAuthorityEpochRef: { current: 10 },
      authSessionRef: { current: null },
      authTransitionAbortRef: { current: { signal: new AbortController().signal } },
      withGuideAuthTransitionLock: async (work: () => Promise<unknown>) => work(),
      currentGuideQueueAuthGeneration: () => 20,
      currentGuideQueueAuthority: () => ({ generation: 20, authorityId: "authority-a", userId: "user-a", businessId: "business-a" }),
      isCurrentGuideQueueAuthClear: () => false,
      clearGuideQueueAuthContext: async () => null,
      sameGuideAuthSession,
      supabase: { auth: {
        getSession: async () => ({ data: { session: { access_token: "token-a", user: { id: "user-a" } } } }),
        signOut,
      } },
      localStorage: { removeItem },
      document: { cookie: "" },
      setError: vi.fn(),
      setAuthed: vi.fn(), setBusinessId: vi.fn(), setBusinessName: vi.fn(), setLogoUrl: vi.fn(),
      setTimezone: vi.fn(), setRole: vi.fn(), setOperators: vi.fn(), setSubscriptionStatus: vi.fn(),
      setYocoTestMode: vi.fn(), setReadOnly: vi.fn(), setHostMismatch: vi.fn(),
    });

    await clearSession(10, { access_token: "token-a", user: { id: "user-a" } });

    expect(signOut).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("drives foreground retries from the worker's durable remaining-attempt count", () => {
    const component = readFileSync("components/GuideServiceWorker.tsx", "utf8");
    const worker = readFileSync("public/guide/sw.js", "utf8");
    expect(component).toContain("status.autoRetriesRemaining === 0");
    expect(component).toContain("Number(event.data.autoRetriesRemaining)");
    expect(component).not.toContain("foregroundRetries");
    expect(worker).toContain("MAX_AUTO_ATTEMPTS - (item.attempts || 0)");
  });

  it("routes shared sign-out through AuthGate and waits for protected completion before reload", async () => {
    const order: string[] = [];
    const setError = vi.fn();
    const setSigningOut = vi.fn();
    const logout = sourceFunction("components/SignOutButton.tsx", "logout", {
      signingOut: false,
      setSigningOut,
      setError,
      PROTECTED_SIGN_OUT_EVENT: "bookingtours:protected-sign-out",
      CustomEvent: class {
        type: string;
        detail: { handled: boolean; complete: (success: boolean) => void };
        constructor(type: string, init: { detail: { handled: boolean; complete: (success: boolean) => void } }) {
          this.type = type;
          this.detail = init.detail;
        }
      },
      window: {
        dispatchEvent: (event: { type: string; detail: { handled: boolean; complete: (success: boolean) => void } }) => {
          expect(event.type).toBe("bookingtours:protected-sign-out");
          event.detail.handled = true;
          order.push("protected-clear-and-sdk-sign-out");
          event.detail.complete(true);
        },
        location: { reload: () => order.push("reload") },
      },
    });

    await logout();

    expect(order).toEqual(["protected-clear-and-sdk-sign-out", "reload"]);
    expect(setError).toHaveBeenCalledWith("");
    const gateSource = readFileSync("components/AuthGate.tsx", "utf8");
    expect(gateSource).toContain("window.addEventListener(PROTECTED_SIGN_OUT_EVENT, onSignOutRequest)");
    expect(gateSource).toContain("clearSession().then(detail.complete)");
  });

  it("keeps shared sign-out in place and reports a failed protected revocation", async () => {
    const setError = vi.fn();
    const setSigningOut = vi.fn();
    const reload = vi.fn();
    const logout = sourceFunction("components/SignOutButton.tsx", "logout", {
      signingOut: false,
      setSigningOut,
      setError,
      PROTECTED_SIGN_OUT_EVENT: "bookingtours:protected-sign-out",
      CustomEvent: class {
        type: string;
        detail: { handled: boolean; complete: (success: boolean) => void };
        constructor(type: string, init: { detail: { handled: boolean; complete: (success: boolean) => void } }) {
          this.type = type;
          this.detail = init.detail;
        }
      },
      window: { dispatchEvent: () => true, location: { reload } },
    });

    await logout();

    expect(reload).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith("Sign out could not be completed safely. Please try again.");
    expect(setSigningOut).toHaveBeenLastCalledWith(false);
  });

  it.each(["returned error", "rejection"] as const)(
    "keeps the connected logout handler in place after SDK %s and succeeds on retry",
    async failureMode => {
      const authority = {
        generation: 100,
        authorityId: "authority-a",
        userId: "user-a",
        businessId: "business-a",
      };
      const session = { access_token: "token-a", user: { id: "user-a" } };
      const authSessionRef = { current: session as typeof session | null };
      const guideAuthorityEpochRef = { current: authority.generation };
      const errors: string[] = [];
      const order: string[] = [];
      const clearCalls: Array<[number, unknown]> = [];
      const removeItem = vi.fn();
      let revoked = false;
      let sdkSession: typeof session | null = session;
      let signOutAttempt = 0;
      let reloads = 0;
      const clearSession = sourceFunction("components/AuthGate.tsx", "clearSession", {
        contextRequestRef: { current: 0 },
        guideAuthorityEpochRef,
        authSessionRef,
        authTransitionAbortRef: { current: new AbortController() },
        withGuideAuthTransitionLock: async (work: () => Promise<unknown>) => {
          order.push("lock");
          try { return await work(); } finally { order.push("unlock"); }
        },
        currentGuideQueueAuthority: () => revoked ? null : authority,
        currentGuideQueueAuthGeneration: () => revoked ? 101 : authority.generation,
        isCurrentGuideQueueAuthClear: (generation: number) => revoked && generation === 101,
        clearGuideQueueAuthContext: async (generation: number, expectedAuthority?: unknown) => {
          clearCalls.push([generation, expectedAuthority]);
          order.push("revoke");
          revoked = true;
          return 101;
        },
        sameGuideAuthSession,
        supabase: { auth: {
          getSession: async () => ({ data: { session: sdkSession } }),
          signOut: async () => {
            signOutAttempt += 1;
            order.push("sdk-signout");
            if (signOutAttempt === 1) {
              if (failureMode === "rejection") throw new Error("synthetic unavailable");
              return { error: new Error("synthetic unavailable") };
            }
            sdkSession = null;
            return { error: null };
          },
        } },
        localStorage: { removeItem },
        document: { cookie: "" },
        setError: (value: string) => errors.push(value),
        setAuthed: vi.fn(), setBusinessId: vi.fn(), setBusinessName: vi.fn(), setStaffName: vi.fn(), setLogoUrl: vi.fn(),
        setTimezone: vi.fn(), setRole: vi.fn(), setOperators: vi.fn(), setSubscriptionStatus: vi.fn(),
        setYocoTestMode: vi.fn(), setReadOnly: vi.fn(), setHostMismatch: vi.fn(),
      });
      const logout = sourceFunction("components/SignOutButton.tsx", "logout", {
        signingOut: false,
        setSigningOut: vi.fn(),
        setError: (value: string) => errors.push(value),
        PROTECTED_SIGN_OUT_EVENT: "bookingtours:protected-sign-out",
        CustomEvent: class {
          type: string;
          detail: { handled: boolean; complete: (success: boolean) => void };
          constructor(type: string, init: { detail: { handled: boolean; complete: (success: boolean) => void } }) {
            this.type = type;
            this.detail = init.detail;
          }
        },
        window: {
          dispatchEvent: (event: { detail: { handled: boolean; complete: (success: boolean) => void } }) => {
            event.detail.handled = true;
            clearSession().then(event.detail.complete).catch(() => event.detail.complete(false));
          },
          location: { reload: () => { reloads += 1; order.push("reload"); } },
        },
      });

      await logout();

      expect(revoked).toBe(true);
      expect(sdkSession).toBe(session);
      expect(authSessionRef.current).toBe(session);
      expect(guideAuthorityEpochRef.current).toBe(101);
      expect(removeItem).not.toHaveBeenCalled();
      expect(reloads).toBe(0);
      expect(errors).toContain("Sign out could not be completed safely. Please try again.");
      expect(clearCalls[0]).toEqual([100, authority]);

      await logout();

      expect(sdkSession).toBeNull();
      expect(authSessionRef.current).toBeNull();
      expect(reloads).toBe(1);
      expect(clearCalls[1]).toEqual([101, undefined]);
      expect(order).toEqual([
        "lock", "revoke", "sdk-signout", "unlock",
        "lock", "revoke", "sdk-signout", "unlock", "reload",
      ]);
    },
  );

  it("offers a deliberate Retry action for exhausted work without changing terminal dismissal", () => {
    const source = readFileSync("components/GuideServiceWorker.tsx", "utf8");
    expect(source).toContain("retryGuideQueueIssue");
    expect(source).toContain("Retry check-in");
    expect(source).toContain("Dismiss reviewed issue");
    expect(source).toContain("status.exhausted");
  });

  it("keeps persisted terminal issues stable without automatic reload or reconciliation loops", () => {
    const workerSource = readFileSync("components/GuideServiceWorker.tsx", "utf8");
    const pageSource = readFileSync("app/guide/slot/[slotId]/page.tsx", "utf8");
    const handlerStart = pageSource.indexOf("const onQueueUpdate");
    const handlerEnd = pageSource.indexOf("window.addEventListener", handlerStart);

    expect(workerSource).not.toContain("issues.forEach(issue =>");
    expect(pageSource.slice(handlerStart, handlerEnd)).not.toContain("reload();");
    expect(pageSource).not.toContain("requestGuideQueueResolution");
  });

  it("sends an explicit terminal acknowledgement with the current owner authority", async () => {
    stubGuideAuthIndexedDb();
    const values = new Map<string, string>();
    const postMessage = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ active: { postMessage } }) },
    });
    const api = guideOffline as unknown as {
      acknowledgeGuideQueueIssue(authority: any, itemId: string): Promise<boolean>;
      clearGuideQueueAuthContext(generation: number): Promise<number | null>;
      currentGuideQueueAuthGeneration(): number;
      currentGuideQueueAuthority(): any;
      establishGuideQueueAuthority(context: any, generation: number): number | null;
      rejectGuideQueueCredential(context: any, generation: number): Promise<boolean>;
      retryGuideQueueIssue(authority: any, itemId: string): Promise<boolean>;
    };
    const current = api.currentGuideQueueAuthGeneration();
    await api.clearGuideQueueAuthContext(current);
    const empty = api.currentGuideQueueAuthGeneration();
    const accessToken = `header.${Buffer.from(JSON.stringify({ iat: 100, exp: 200 })).toString("base64url")}.signature`;
    const context = { userId: "user-a", businessId: "business-a", accessToken };
    api.establishGuideQueueAuthority(context, empty);
    const authority = api.currentGuideQueueAuthority();
    postMessage.mockClear();

    await expect(postGuideQueueAuthContext(context, authority.generation)).resolves.toBe(true);
    const authMessage = postMessage.mock.calls[0][0];
    expect(authMessage).toEqual(expect.objectContaining({
      type: "GUIDE_AUTH_CONTEXT",
      context: expect.objectContaining({
        credentialId: expect.stringMatching(/^[a-f0-9]{64}$/),
        credentialIssuedAt: 100,
        credentialExpiresAt: 200,
      }),
    }));
    postMessage.mockClear();

    await expect(api.rejectGuideQueueCredential(context, authority.generation)).resolves.toBe(true);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "GUIDE_AUTH_REJECTED",
      credentialId: authMessage.context.credentialId,
    }));
    postMessage.mockClear();

    await expect(api.acknowledgeGuideQueueIssue(authority, "event-a")).resolves.toBe(true);

    expect(postMessage).toHaveBeenCalledWith({
      type: "GUIDE_ACKNOWLEDGE_ISSUE",
      generation: authority.generation,
      authorityId: authority.authorityId,
      userId: "user-a",
      businessId: "business-a",
      itemId: "event-a",
    });
    postMessage.mockClear();

    await expect(api.retryGuideQueueIssue(authority, "event-a")).resolves.toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: "GUIDE_RETRY_ISSUE",
      generation: authority.generation,
      authorityId: authority.authorityId,
      userId: "user-a",
      businessId: "business-a",
      itemId: "event-a",
    });
  });
});

const canonicalArrival = sourceFunction("app/guide/slot/[slotId]/page.tsx", "canonicalArrival", {});

function pageFixture(options: {
  online?: boolean;
  response?: number | "network";
  responseBody?: Record<string, unknown>;
  responseBodyError?: boolean;
  responseHeaders?: Record<string, string>;
  queueError?: boolean;
  published?: boolean;
  readOnly?: boolean;
  deferSession?: boolean;
  deferResponse?: boolean;
  deferQueue?: boolean;
  missingSession?: boolean;
  clearAdvancesAuthority?: boolean;
} = {}) {
  let bookings = [{
    id: "booking-a", customer_name: "Guest", phone: "", qty: 4, arrived_count: 2,
    checked_in: false, checked_in_at: null, waiver_status: "SIGNED", dietary: null, add_ons: [],
  }];
  const notify = vi.fn();
  let queueStarted = false;
  let releaseQueue: (() => void) | undefined;
  const queueGate = options.deferQueue ? new Promise<void>(resolve => { releaseQueue = resolve; }) : null;
  const queueGuideCheckIn = vi.fn(async () => {
    queueStarted = true;
    if (queueGate) await queueGate;
    if (options.queueError) throw new Error("persistence failed");
  });
  const postGuideQueueAuthContext = vi.fn(async () => options.published ?? true);
  const registerGuideCheckInSync = vi.fn(async () => {});
  const requestGuideQueueStatus = vi.fn(async () => {});
  const rejectGuideQueueCredential = vi.fn(async () => true);
  const removeGuideQueueItem = vi.fn(async () => {});
  const reload = vi.fn(async () => {});
  const generation = { current: 10 };
  let clearedGeneration: number | null = null;
  const clearGuideQueueAuthContext = vi.fn(async () => {
    if (options.clearAdvancesAuthority) generation.current += 1;
    clearedGeneration = generation.current;
    return clearedGeneration;
  });
  const mountedRef = { current: true };
  let bookingUpdates = 0;
  let sessionStarted = false;
  let releaseSession: (() => void) | undefined;
  const sessionGate = options.deferSession ? new Promise<void>(resolve => { releaseSession = resolve; }) : null;
  let fetchStarted = false;
  let releaseResponse: (() => void) | undefined;
  const responseGate = options.deferResponse ? new Promise<void>(resolve => { releaseResponse = resolve; }) : null;
  const fetchImpl = vi.fn(async () => {
    fetchStarted = true;
    if (responseGate) await responseGate;
    if (options.response === "network") throw new Error("offline");
    const status = options.response || 200;
    if (options.responseBodyError) {
      return { ok: true, status, headers: new Headers(options.responseHeaders), json: async () => { throw new Error("body lost"); } } as Response;
    }
    const body = options.responseBody || (status === 200
      ? { ok: true, replay: false, arrived_count: 4, qty: 4, checked_in: true, checked_in_at: "2026-09-20T08:00:00.000Z", slot_id: "slot-a" }
      : { ok: false, error: "fixture rejection" });
    return Response.json(body, { status, headers: options.responseHeaders });
  });
  const checkIn = sourceFunction("app/guide/slot/[slotId]/page.tsx", "checkIn", {
    bookings,
    readOnly: options.readOnly || false,
    businessId: "business-a",
    slotId: "slot-a",
    currentGuideQueueAuthGeneration: () => generation.current,
    currentGuideQueueAuthority: () => generation.current === 10 ? {
      generation: 10,
      authorityId: "authority-a",
      userId: "user-a",
      businessId: "business-a",
    } : null,
    isCurrentGuideQueueAuthClear: (expected: number) => clearedGeneration === expected && generation.current === expected,
    isCurrentGuideQueueAuthContext: (auth: { userId: string; businessId: string }, expected: number) =>
      generation.current === expected && auth.userId === "user-a" && auth.businessId === "business-a",
    crypto: { randomUUID: () => "event-a" },
    mountedRef,
    setBookings: (update: any) => {
      bookingUpdates += 1;
      bookings = typeof update === "function" ? update(bookings) : update;
    },
    supabase: { auth: { getSession: async () => {
      sessionStarted = true;
      if (sessionGate) await sessionGate;
      return { data: { session: options.missingSession ? null : { access_token: "current-token", user: { id: "user-a" } } } };
    } } },
    guideQueueAuthContext,
    guideQueueRetryAt: guideOffline.guideQueueRetryAt,
    clearGuideQueueAuthContext,
    createGuideQueueItem,
    queueGuideCheckIn,
    removeGuideQueueItem,
    postGuideQueueAuthContext,
    registerGuideCheckInSync,
    requestGuideQueueStatus,
    rejectGuideQueueCredential,
    navigator: { onLine: options.online ?? true },
    fetch: fetchImpl,
    notify,
    canonicalArrival,
    reload,
  });
  return {
    bookings: () => bookings,
    checkIn,
    clearGuideQueueAuthContext,
    fetchImpl,
    notify,
    postGuideQueueAuthContext,
    queueGuideCheckIn,
    removeGuideQueueItem,
    registerGuideCheckInSync,
    requestGuideQueueStatus,
    rejectGuideQueueCredential,
    reload,
    bookingUpdates: () => bookingUpdates,
    fetchStarted: () => fetchStarted,
    queueStarted: () => queueStarted,
    releaseQueue: () => releaseQueue?.(),
    releaseResponse: () => releaseResponse?.(),
    sessionStarted: () => sessionStarted,
    switchAuthority: () => { generation.current += 1; releaseSession?.(); },
    unmount: () => { mountedRef.current = false; },
  };
}

describe("guide foreground check-in", () => {
  it.each(["network", 429] as const)("queues retryable %s failure with one stable partial-arrival event", async response => {
    const f = pageFixture({ response });
    await f.checkIn("booking-a");

    expect(f.queueGuideCheckIn).toHaveBeenCalledOnce();
    const queued = f.queueGuideCheckIn.mock.calls[0][0];
    expect(queued).toMatchObject({ id: "event-a", userId: "user-a", businessId: "business-a", status: "pending" });
    expect(queued).not.toHaveProperty("token");
    expect(queued.payload).toEqual(payload());
    if (response === "network") expect(JSON.parse(String(f.fetchImpl.mock.calls[0][1]?.body))).toEqual(queued.payload);
    expect(f.postGuideQueueAuthContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-a", businessId: "business-a" }),
      10,
      expect.any(Function),
    );
    expect(f.registerGuideCheckInSync).not.toHaveBeenCalled();
    expect(f.requestGuideQueueStatus).toHaveBeenCalledOnce();
    expect(f.bookings()[0]).toMatchObject({ arrived_count: 4, checked_in: true });
  });

  it("preserves foreground 429 Retry-After without immediately requesting replay", async () => {
    const before = Date.now();
    const f = pageFixture({ response: 429, responseHeaders: { "Retry-After": "12" } });

    await f.checkIn("booking-a");

    expect(f.queueGuideCheckIn).toHaveBeenCalledOnce();
    expect(f.queueGuideCheckIn.mock.calls[0][0]).toMatchObject({
      id: "event-a",
      status: "pending",
      attempts: 1,
      nextAttemptAt: expect.any(Number),
    });
    expect(f.queueGuideCheckIn.mock.calls[0][0].nextAttemptAt).toBeGreaterThanOrEqual(before + 12_000);
    expect(f.registerGuideCheckInSync).not.toHaveBeenCalled();
    expect(f.requestGuideQueueStatus).toHaveBeenCalledOnce();
  });

  it("queues while offline without attempting a request", async () => {
    const f = pageFixture({ online: false });
    await f.checkIn("booking-a");

    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.queueGuideCheckIn).toHaveBeenCalledOnce();
    expect(f.registerGuideCheckInSync).toHaveBeenCalledOnce();
  });

  it("restores optimistic state and reports expiry after its own missing-session clear", async () => {
    const f = pageFixture({ missingSession: true, clearAdvancesAuthority: true });
    await f.checkIn("booking-a");

    expect(f.clearGuideQueueAuthContext).toHaveBeenCalledWith(10);
    expect(f.bookings()[0]).toMatchObject({ arrived_count: 2, checked_in: false, checked_in_at: null });
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({
      tone: "error",
      message: expect.stringContaining("Session expired"),
    }));
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.queueGuideCheckIn).not.toHaveBeenCalled();
  });

  it("reverts and visibly reports local persistence failure", async () => {
    const f = pageFixture({ response: "network", queueError: true });
    await f.checkIn("booking-a");

    expect(f.bookings()[0]).toMatchObject({ arrived_count: 2, checked_in: false, checked_in_at: null });
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ tone: "error", message: expect.stringContaining("saved offline") }));
    expect(f.registerGuideCheckInSync).not.toHaveBeenCalled();
  });

  it("applies canonical response-loss replay state instead of the optimistic full count", async () => {
    const f = pageFixture({ responseBody: { ok: true, replay: true, arrived_count: 2, qty: 4, checked_in: false, checked_in_at: null, slot_id: "slot-a" } });
    await f.checkIn("booking-a");

    expect(f.bookings()[0]).toMatchObject({ qty: 4, arrived_count: 2, checked_in: false, checked_in_at: null });
    expect(f.queueGuideCheckIn).not.toHaveBeenCalled();
  });

  it("queues a lost or malformed 2xx body with the original stable event", async () => {
    const f = pageFixture({ responseBodyError: true });
    await f.checkIn("booking-a");

    expect(f.queueGuideCheckIn).toHaveBeenCalledOnce();
    expect(f.queueGuideCheckIn.mock.calls[0][0]).toMatchObject({
      id: "event-a",
      payload: expect.objectContaining({ client_event_id: "event-a" }),
    });
    expect(f.bookings()[0]).toMatchObject({ arrived_count: 4, checked_in: true });
  });

  it("abandons without publishing stale UI after authority changes while getSession is pending", async () => {
    const f = pageFixture({ deferSession: true });
    const action = f.checkIn("booking-a");
    await vi.waitFor(() => expect(f.sessionStarted()).toBe(true));
    f.switchAuthority();
    await action;

    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.queueGuideCheckIn).not.toHaveBeenCalled();
    expect(f.bookingUpdates()).toBe(1);
    expect(f.notify).not.toHaveBeenCalled();
  });

  it("retains an owner-bound event when authority changes after request submission", async () => {
    const f = pageFixture({ response: "network", deferResponse: true });
    const action = f.checkIn("booking-a");
    await vi.waitFor(() => expect(f.fetchStarted()).toBe(true));
    f.switchAuthority();
    f.releaseResponse();
    await action;

    expect(f.queueGuideCheckIn).toHaveBeenCalledOnce();
    expect(f.queueGuideCheckIn.mock.calls[0][0]).toMatchObject({
      id: "event-a",
      userId: "user-a",
      businessId: "business-a",
      status: "pending",
      payload: expect.objectContaining({ client_event_id: "event-a" }),
    });
    expect(f.removeGuideQueueItem).not.toHaveBeenCalled();
    expect(f.postGuideQueueAuthContext).not.toHaveBeenCalled();
    expect(f.registerGuideCheckInSync).not.toHaveBeenCalled();
    expect(f.notify).not.toHaveBeenCalled();
  });

  it("does not delete durable owner work when authority changes during persistence", async () => {
    const f = pageFixture({ online: false, deferQueue: true });
    const action = f.checkIn("booking-a");
    await vi.waitFor(() => expect(f.queueStarted()).toBe(true));
    f.switchAuthority();
    f.releaseQueue();
    await action;

    expect(f.queueGuideCheckIn).toHaveBeenCalledOnce();
    expect(f.removeGuideQueueItem).not.toHaveBeenCalled();
    expect(f.postGuideQueueAuthContext).not.toHaveBeenCalled();
    expect(f.registerGuideCheckInSync).not.toHaveBeenCalled();
    expect(f.notify).not.toHaveBeenCalled();
  });

  it("keeps a completed durable save but publishes nothing after unmount", async () => {
    const f = pageFixture({ online: false, deferQueue: true });
    const action = f.checkIn("booking-a");
    await vi.waitFor(() => expect(f.queueStarted()).toBe(true));
    f.unmount();
    f.releaseQueue();
    await action;

    expect(f.queueGuideCheckIn).toHaveBeenCalledOnce();
    expect(f.postGuideQueueAuthContext).not.toHaveBeenCalled();
    expect(f.registerGuideCheckInSync).not.toHaveBeenCalled();
    expect(f.requestGuideQueueStatus).not.toHaveBeenCalled();
    expect(f.notify).not.toHaveBeenCalled();
  });

  it("does not publish stale persistence failure state after unmount", async () => {
    const f = pageFixture({ online: false, deferQueue: true, queueError: true });
    const action = f.checkIn("booking-a");
    await vi.waitFor(() => expect(f.queueStarted()).toBe(true));
    f.unmount();
    f.releaseQueue();
    await action;

    expect(f.bookingUpdates()).toBe(1);
    expect(f.notify).not.toHaveBeenCalled();
  });

  it("applies a worker canonical replay to the matching optimistic booking", () => {
    const reconcile = sourceFunction("app/guide/slot/[slotId]/page.tsx", "reconcileGuideBooking", { canonicalArrival });
    const current = [{
      id: "booking-a", customer_name: "Guest", phone: "", qty: 4, arrived_count: 4,
      checked_in: true, checked_in_at: "optimistic", waiver_status: "SIGNED", dietary: null, add_ons: [],
    }];

    const next = reconcile(current, {
      kind: "canonical",
      bookingId: "booking-a",
      slotId: "slot-a",
      canonical: { ok: true, replay: true, arrived_count: 2, qty: 4, checked_in: false, checked_in_at: null, slot_id: "slot-a" },
    });

    expect(next[0]).toMatchObject({ arrived_count: 2, checked_in: false, checked_in_at: null });
  });

  it("retains a direct 409 conflict for deliberate owner resolution without automatic retry", async () => {
    const f = pageFixture({ response: 409, responseBody: { ok: false, code: "STALE", error: "Arrival count changed", arrived_count: 3, qty: 4 } });
    await f.checkIn("booking-a");

    expect(f.bookings()[0]).toMatchObject({ arrived_count: 2, checked_in: false });
    expect(f.queueGuideCheckIn).toHaveBeenCalledWith(expect.objectContaining({
      id: "event-a",
      userId: "user-a",
      businessId: "business-a",
      status: "failed",
      lastError: "STALE",
    }));
    expect(f.registerGuideCheckInSync).not.toHaveBeenCalled();
    expect(f.requestGuideQueueStatus).toHaveBeenCalledOnce();
    expect(f.reload).not.toHaveBeenCalled();
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ message: "Arrival count changed" }));
  });

  it("retains a direct 401 with its stable event and owner for reauthentication", async () => {
    const f = pageFixture({ response: 401, responseBody: { ok: false, error: "Unauthorized" } });
    await f.checkIn("booking-a");

    expect(f.bookings()[0]).toMatchObject({ arrived_count: 2, checked_in: false });
    expect(f.queueGuideCheckIn).toHaveBeenCalledWith(expect.objectContaining({
      id: "event-a",
      userId: "user-a",
      businessId: "business-a",
      status: "needs_reauth",
      lastError: "unauthorized",
      payload: expect.objectContaining({ client_event_id: "event-a" }),
    }));
    expect(f.rejectGuideQueueCredential).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-a",
      businessId: "business-a",
    }), 10);
    expect(f.clearGuideQueueAuthContext).not.toHaveBeenCalled();
    expect(f.registerGuideCheckInSync).not.toHaveBeenCalled();
    expect(f.requestGuideQueueStatus).toHaveBeenCalledOnce();
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("sign in again") }));
  });

  it.each([403, 422])("retains direct %s rejection for deliberate owner acknowledgement", async response => {
    const f = pageFixture({
      response,
      responseBody: { ok: false, code: response === 403 ? "WAIVER_REQUIRED" : "PAYMENT_REQUIRED", error: "Review required" },
    });
    await f.checkIn("booking-a");

    expect(f.queueGuideCheckIn).toHaveBeenCalledWith(expect.objectContaining({
      id: "event-a",
      userId: "user-a",
      businessId: "business-a",
      status: "failed",
      lastError: response === 403 ? "WAIVER_REQUIRED" : "PAYMENT_REQUIRED",
      payload: expect.objectContaining({ client_event_id: "event-a" }),
    }));
    expect(f.registerGuideCheckInSync).not.toHaveBeenCalled();
    expect(f.requestGuideQueueStatus).toHaveBeenCalledOnce();
  });

  it("keeps read-only demo actions local and side-effect free", async () => {
    const f = pageFixture({ readOnly: true });
    await f.checkIn("booking-a");

    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.queueGuideCheckIn).not.toHaveBeenCalled();
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ tone: "warning" }));
  });
});

describe("guide arrival server boundary", () => {
  it("continues delegating to the shared transaction-backed partial-arrival handler", () => {
    const route = readFileSync("app/api/guide/check-in/route.ts", "utf8");
    expect(route).toContain('handleBookingArrivalRequest(req, "guide-pwa")');
    expect(route).not.toContain("createClient(");
    expect(route).not.toContain('.from("bookings")');
  });
});
