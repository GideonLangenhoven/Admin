export type GuideQueueAuthContext = {
  userId: string;
  businessId: string;
  accessToken: string;
};

export type GuideQueueAuthority = {
  generation: number;
  authorityId: string;
  userId: string;
  businessId: string;
};

export type GuideCheckInPayload = {
  booking_id: string;
  slot_id: string;
  arrived_count: number | null;
  expected_arrived_count: number | null;
  client_event_id: string;
};

export type GuideCanonicalArrival = {
  ok: true;
  replay: boolean;
  arrived_count: number;
  qty: number;
  checked_in: boolean;
  checked_in_at: string | null;
  slot_id: string;
};

export type GuideQueueUpdate = {
  kind: "canonical" | "terminal";
  id: string;
  userId: string;
  businessId: string;
  bookingId: string;
  slotId: string;
  reason?: string;
  canonical?: GuideCanonicalArrival;
};

export type GuideQueueItem = {
  id: string;
  payload: GuideCheckInPayload;
  queuedAt: number;
  userId: string;
  businessId: string;
  status: "pending" | "needs_reauth" | "failed" | "retry_exhausted";
  attempts: number;
  lastError?: string;
  serverError?: string | null;
  updatedAt?: number;
  nextAttemptAt?: number;
};

export type GuideQueueStatus = {
  pending: number;
  needsReauth: number;
  failed: number;
  blocked: number;
  exhausted: number;
  autoRetriesRemaining: number;
  nextAttemptAt: number | null;
  issues: Array<{
    id: string;
    reason: string;
    userId?: string;
    businessId?: string;
    bookingId?: string;
    slotId?: string;
    legacy?: boolean;
    retryable?: boolean;
  }>;
};

type SessionLike = {
  access_token?: string;
  user?: { id?: string } | null;
} | null;

type StoredAuthority = {
  generation: number;
  authorityId: string;
  userId: string | null;
  businessId: string | null;
};

type WorkerCredentialContext = GuideQueueAuthContext & {
  credentialId: string;
  credentialIssuedAt: number;
  credentialExpiresAt: number;
};

type SyncRegistration = ServiceWorkerRegistration & {
  sync?: { register(tag: string): Promise<void> };
};

const DB_NAME = "guide-queue-v2";
const DB_VERSION = 1;
const QUEUE_STORE = "check-ins";
const AUTH_STORE = "auth-context";
const SYNC_TAG = "sync-check-ins-v2";
const AUTHORITY_STORAGE_KEY = "guide-queue-authority-v2";
const AUTH_TRANSITION_LOCK = "bookingtours-guide-auth-transition-v1";
const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;
export const GUIDE_QUEUE_UPDATE_EVENT = "guide-queue-update";

function newAuthorityId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

async function credentialId(accessToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function tokenPayload(accessToken: string): Record<string, unknown> | null {
  try {
    const encoded = accessToken.split(".")[1];
    if (!encoded || typeof atob !== "function") throw new Error("missing JWT payload");
    return JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
  } catch {
    return null;
  }
}

function credentialTimes(accessToken: string): Pick<WorkerCredentialContext, "credentialIssuedAt" | "credentialExpiresAt"> {
  try {
    const payload = tokenPayload(accessToken);
    const issuedAt = Number(payload?.iat);
    const expiresAt = Number(payload?.exp);
    if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) {
      throw new Error("invalid JWT times");
    }
    return { credentialIssuedAt: issuedAt, credentialExpiresAt: expiresAt };
  } catch {
    return { credentialIssuedAt: 0, credentialExpiresAt: 0 };
  }
}

export function sameGuideAuthSession(left: SessionLike, right: SessionLike): boolean {
  if (!left || !right) return left === right;
  if (!left.access_token || !right.access_token || !left.user?.id || left.user.id !== right.user?.id) return false;
  const leftSessionId = tokenPayload(left.access_token)?.session_id;
  const rightSessionId = tokenPayload(right.access_token)?.session_id;
  if (typeof leftSessionId === "string" && leftSessionId && typeof rightSessionId === "string" && rightSessionId) {
    return leftSessionId === rightSessionId;
  }
  return left.access_token === right.access_token;
}

export async function withGuideAuthTransitionLock<T>(
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    throw new Error("Web Locks are required for safe account transitions");
  }
  return navigator.locks.request(
    AUTH_TRANSITION_LOCK,
    { mode: "exclusive", ...(signal ? { signal } : {}) },
    work,
  );
}

let memoryAuthority: StoredAuthority = {
  generation: Date.now(),
  authorityId: newAuthorityId(),
  userId: null,
  businessId: null,
};
let lastDurableClear: Pick<StoredAuthority, "generation" | "authorityId"> | null = null;

function nextGeneration(current: number): number {
  return Math.max(current + 1, Date.now());
}

function validStoredAuthority(value: unknown): value is StoredAuthority {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredAuthority>;
  return Number.isSafeInteger(candidate.generation)
    && candidate.generation! > 0
    && typeof candidate.authorityId === "string"
    && candidate.authorityId.length > 0
    && (typeof candidate.userId === "string" || candidate.userId === null)
    && (typeof candidate.businessId === "string" || candidate.businessId === null)
    && (!!candidate.userId === !!candidate.businessId);
}

function readAuthority(): StoredAuthority {
  if (typeof localStorage === "undefined") return memoryAuthority;
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTHORITY_STORAGE_KEY) || "null");
    if (validStoredAuthority(parsed)) {
      memoryAuthority = parsed;
      return parsed;
    }
    localStorage.setItem(AUTHORITY_STORAGE_KEY, JSON.stringify(memoryAuthority));
  } catch { /* memory fallback keeps auth fail-closed */ }
  return memoryAuthority;
}

function writeAuthority(authority: StoredAuthority): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(AUTHORITY_STORAGE_KEY, JSON.stringify(authority));
    memoryAuthority = authority;
    return true;
  } catch {
    return false;
  }
}

export function currentGuideQueueAuthGeneration(): number {
  return readAuthority().generation;
}

export function currentGuideQueueAuthority(): GuideQueueAuthority | null {
  const current = readAuthority();
  if (!current.userId || !current.businessId) return null;
  return {
    generation: current.generation,
    authorityId: current.authorityId,
    userId: current.userId,
    businessId: current.businessId,
  };
}

export function isCurrentGuideQueueAuthClear(generation: number): boolean {
  const current = readAuthority();
  return lastDurableClear?.generation === generation
    && lastDurableClear.authorityId === current.authorityId
    && current.generation === generation
    && !current.userId
    && !current.businessId;
}

export function establishGuideQueueAuthority(context: GuideQueueAuthContext, expectedGeneration: number): number | null {
  const current = readAuthority();
  if (current.generation !== expectedGeneration) return null;
  if (current.userId === context.userId && current.businessId === context.businessId) return current.generation;
  if (current.userId || current.businessId) return null;
  const generation = nextGeneration(current.generation);
  if (!writeAuthority({
    generation,
    authorityId: newAuthorityId(),
    userId: context.userId,
    businessId: context.businessId,
  })) return null;
  return generation;
}

export function isCurrentGuideQueueAuthContext(context: GuideQueueAuthContext, generation: number): boolean {
  const current = readAuthority();
  return current.generation === generation
    && current.userId === context.userId
    && current.businessId === context.businessId;
}

export function guideQueueAuthContext(session: SessionLike, businessId: string): GuideQueueAuthContext | null {
  const userId = session?.user?.id;
  const accessToken = session?.access_token;
  if (!userId || !businessId || !accessToken) return null;
  return { userId, businessId, accessToken };
}

export async function activateGuideQueueAuthContext(
  context: GuideQueueAuthContext,
  expectedGeneration: number,
  canPublish = () => true,
): Promise<number | null> {
  let current = readAuthority();
  if (current.generation !== expectedGeneration) return null;
  if (current.userId === context.userId && current.businessId === context.businessId) {
    await postGuideQueueAuthContext(context, current.generation, canPublish).catch(() => false);
    return current.generation;
  }
  const cleared = await clearGuideQueueAuthContext(
    expectedGeneration,
    current.userId || current.businessId ? {
      userId: current.userId || "",
      businessId: current.businessId || "",
    } : undefined,
  );
  if (cleared === null) return null;
  expectedGeneration = cleared;
  current = readAuthority();
  if (current.generation !== expectedGeneration || current.userId || current.businessId) return null;
  const generation = establishGuideQueueAuthority(context, expectedGeneration);
  if (generation === null) return null;
  await postGuideQueueAuthContext(context, generation, canPublish).catch(() => false);
  return generation;
}

export function createGuideQueueItem(payload: GuideCheckInPayload, auth: GuideQueueAuthContext): GuideQueueItem {
  return {
    id: payload.client_event_id,
    payload,
    queuedAt: Date.now(),
    userId: auth.userId,
    businessId: auth.businessId,
    status: "pending",
    attempts: 0,
  };
}

export function guideQueueRetryAt(retryAfter: string | null, attempt = 1, now = Date.now()): number {
  const exponential = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1)));
  let requested = 0;
  const value = retryAfter?.trim();
  if (value && /^\d+$/.test(value)) requested = Number(value) * 1_000;
  else if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) requested = parsed - now;
  }
  return now + Math.min(MAX_RETRY_DELAY_MS, Math.max(exponential, Number.isFinite(requested) ? requested : 0));
}

export async function queueGuideCheckIn(item: GuideQueueItem): Promise<void> {
  const db = await openGuideQueue();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, "readwrite");
      tx.objectStore(QUEUE_STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Guide queue persistence aborted"));
    });
  } finally {
    db.close();
  }
}

export async function registerGuideCheckInSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/guide/") as SyncRegistration | undefined;
  if (registration?.sync) {
    try {
      await registration.sync.register(SYNC_TAG);
      return;
    } catch { /* active-worker fallback below */ }
  }
  registration?.active?.postMessage({ type: "GUIDE_SYNC_REQUEST" });
}

export async function postGuideQueueAuthContext(
  context: GuideQueueAuthContext | null,
  expectedGeneration: number,
  isCurrent = () => true,
): Promise<boolean> {
  const canPost = () => {
    if (!isCurrent()) return false;
    const current = readAuthority();
    if (current.generation !== expectedGeneration) return false;
    return context
      ? current.userId === context.userId && current.businessId === context.businessId
      : !current.userId && !current.businessId;
  };
  if (!canPost()) return false;
  const workerContext: WorkerCredentialContext | null = context
    ? {
        ...context,
        credentialId: await credentialId(context.accessToken),
        ...credentialTimes(context.accessToken),
      }
    : null;
  if (!canPost()) return false;
  return postGuideWorkerMessage(
    {
      type: "GUIDE_AUTH_CONTEXT",
      context: workerContext,
      generation: expectedGeneration,
      authorityId: readAuthority().authorityId,
    },
    canPost,
  );
}

export async function clearGuideQueueAuthContext(
  expectedGeneration: number,
  expectedContext?: Pick<GuideQueueAuthContext, "userId" | "businessId">,
): Promise<number | null> {
  const current = readAuthority();
  if (current.generation !== expectedGeneration) return null;
  if (expectedContext && (current.userId !== expectedContext.userId || current.businessId !== expectedContext.businessId)) return null;
  const generation = current.userId || current.businessId ? nextGeneration(current.generation) : current.generation;
  const proposedClear = {
    generation,
    authorityId: current.userId || current.businessId ? newAuthorityId() : current.authorityId,
    userId: null,
    businessId: null,
  } satisfies StoredAuthority;
  let cleared: StoredAuthority | null = null;
  try {
    cleared = await persistGuideWorkerAuthorityClear(current, proposedClear);
  } catch {
    return null;
  }
  if (!cleared) return null;
  const latest = readAuthority();
  if (!sameStoredAuthority(latest, current) && !sameStoredAuthority(latest, cleared)) return null;
  if (!sameStoredAuthority(latest, cleared) && !writeAuthority(cleared)) return null;
  if (!sameStoredAuthority(readAuthority(), cleared)) return null;
  lastDurableClear = { generation: cleared.generation, authorityId: cleared.authorityId };
  await postGuideQueueAuthContext(null, cleared.generation).catch(() => false);
  if (!sameStoredAuthority(readAuthority(), cleared)) return null;
  return cleared.generation;
}

export async function requestGuideQueueStatus(): Promise<void> {
  await postGuideWorkerMessage({ type: "GUIDE_QUEUE_STATUS_REQUEST" });
}

export async function acknowledgeGuideQueueIssue(
  authority: GuideQueueAuthority,
  itemId: string,
): Promise<boolean> {
  return postGuideQueueIssueAction("GUIDE_ACKNOWLEDGE_ISSUE", authority, itemId);
}

export async function retryGuideQueueIssue(
  authority: GuideQueueAuthority,
  itemId: string,
): Promise<boolean> {
  return postGuideQueueIssueAction("GUIDE_RETRY_ISSUE", authority, itemId);
}

async function postGuideQueueIssueAction(
  type: "GUIDE_ACKNOWLEDGE_ISSUE" | "GUIDE_RETRY_ISSUE",
  authority: GuideQueueAuthority,
  itemId: string,
): Promise<boolean> {
  const canPost = () => {
    const current = currentGuideQueueAuthority();
    return !!current
      && current.generation === authority.generation
      && current.authorityId === authority.authorityId
      && current.userId === authority.userId
      && current.businessId === authority.businessId;
  };
  if (!itemId || !canPost()) return false;
  return postGuideWorkerMessage({
    type,
    generation: authority.generation,
    authorityId: authority.authorityId,
    userId: authority.userId,
    businessId: authority.businessId,
    itemId,
  }, canPost);
}

export async function rejectGuideQueueCredential(
  context: GuideQueueAuthContext,
  generation: number,
): Promise<boolean> {
  const canPost = () => {
    const current = currentGuideQueueAuthority();
    return !!current
      && current.generation === generation
      && current.userId === context.userId
      && current.businessId === context.businessId;
  };
  if (!canPost()) return false;
  const authority = currentGuideQueueAuthority()!;
  const rejectedCredentialId = await credentialId(context.accessToken);
  if (!canPost()) return false;
  return postGuideWorkerMessage({
    type: "GUIDE_AUTH_REJECTED",
    generation,
    authorityId: authority.authorityId,
    userId: context.userId,
    businessId: context.businessId,
    credentialId: rejectedCredentialId,
  }, canPost);
}

async function postGuideWorkerMessage(message: Record<string, unknown>, canPost = () => true): Promise<boolean> {
  if (!canPost()) return false;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  const registration = await navigator.serviceWorker.getRegistration("/guide/");
  if (!canPost()) return false;
  const workers = new Set<ServiceWorker>();
  if (registration?.active) workers.add(registration.active);
  if (registration?.waiting) workers.add(registration.waiting);
  if (registration?.installing) workers.add(registration.installing);
  workers.forEach(worker => worker.postMessage(message));
  return workers.size > 0;
}

function sameStoredAuthority(left: StoredAuthority, right: StoredAuthority): boolean {
  return left.generation === right.generation
    && left.authorityId === right.authorityId
    && left.userId === right.userId
    && left.businessId === right.businessId;
}

async function persistGuideWorkerAuthorityClear(
  previous: StoredAuthority,
  proposedClear: StoredAuthority,
): Promise<StoredAuthority | null> {
  const db = await openGuideQueue();
  try {
    return await new Promise<StoredAuthority | null>((resolve, reject) => {
      const tx = db.transaction(AUTH_STORE, "readwrite");
      const store = tx.objectStore(AUTH_STORE);
      const request = store.get("current");
      let durableClear: StoredAuthority | null = null;
      request.onsuccess = () => {
        const current = request.result as {
          generation?: unknown;
          authorityId?: unknown;
          context?: unknown;
          owner?: unknown;
          clearedFromAuthorityId?: unknown;
        } | undefined;
        const currentGeneration = Number.isSafeInteger(current?.generation) ? Number(current?.generation) : 0;
        const recoverableClear = currentGeneration > previous.generation
          && typeof current?.authorityId === "string"
          && current.authorityId
          && !current.context
          && !current.owner
          && current.clearedFromAuthorityId === previous.authorityId;
        if (recoverableClear) {
          durableClear = {
            generation: currentGeneration,
            authorityId: current!.authorityId as string,
            userId: null,
            businessId: null,
          };
          return;
        }
        const exactPrevious = currentGeneration === previous.generation
          && current?.authorityId === previous.authorityId;
        if (currentGeneration < previous.generation || exactPrevious) {
          store.put({
            generation: proposedClear.generation,
            authorityId: proposedClear.authorityId,
            context: null,
            owner: null,
            clearedFromAuthorityId: previous.authorityId,
            credentialRevision: null,
            retiredCredentialIds: [],
          }, "current");
          durableClear = proposedClear;
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(durableClear);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Guide queue authority clear aborted"));
    });
  } finally {
    db.close();
  }
}

function openGuideQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}
