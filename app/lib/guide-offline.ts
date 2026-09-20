export type GuideQueueAuthContext = {
  userId: string;
  businessId: string;
  accessToken: string;
};

export type GuideCheckInPayload = {
  booking_id: string;
  slot_id: string;
  client_event_id: string;
};

export type GuideQueueItem = {
  id: string;
  payload: GuideCheckInPayload;
  queuedAt: number;
  userId: string;
  businessId: string;
  status: "pending";
  attempts: number;
};

export type GuideQueueStatus = {
  pending: number;
  needsReauth: number;
  failed: number;
  blocked: number;
};

type SessionLike = {
  access_token?: string;
  user?: { id?: string } | null;
} | null;

type SyncRegistration = ServiceWorkerRegistration & {
  sync?: { register(tag: string): Promise<void> };
};

const DB_NAME = "guide-queue-v2";
const DB_VERSION = 1;
const QUEUE_STORE = "check-ins";
const AUTH_STORE = "auth-context";
const SYNC_TAG = "sync-check-ins-v2";
let authGeneration = Date.now();

export function beginGuideQueueAuthGeneration(): number {
  authGeneration = Math.max(authGeneration + 1, Date.now());
  return authGeneration;
}

export function currentGuideQueueAuthGeneration(): number {
  return authGeneration;
}

export function guideQueueAuthContext(session: SessionLike, businessId: string): GuideQueueAuthContext | null {
  const userId = session?.user?.id;
  const accessToken = session?.access_token;
  if (!userId || !businessId || !accessToken) return null;
  return { userId, businessId, accessToken };
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

export async function queueGuideCheckIn(item: GuideQueueItem): Promise<void> {
  const db = await openGuideQueue();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function registerGuideCheckInSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/guide/") as SyncRegistration | undefined;
  if (registration?.sync) {
    await registration.sync.register(SYNC_TAG);
  } else {
    registration?.active?.postMessage({ type: "GUIDE_SYNC_REQUEST" });
  }
}

export async function postGuideQueueAuthContext(
  context: GuideQueueAuthContext | null,
  expectedGeneration = currentGuideQueueAuthGeneration(),
): Promise<boolean> {
  if (expectedGeneration !== currentGuideQueueAuthGeneration()) return false;
  return postGuideWorkerMessage(
    { type: "GUIDE_AUTH_CONTEXT", context, generation: expectedGeneration },
    () => expectedGeneration === currentGuideQueueAuthGeneration(),
  );
}

export async function clearGuideQueueAuthContext(expectedGeneration?: number): Promise<boolean> {
  if (expectedGeneration !== undefined && expectedGeneration !== currentGuideQueueAuthGeneration()) return false;
  const generation = beginGuideQueueAuthGeneration();
  return postGuideQueueAuthContext(null, generation);
}

export async function requestGuideQueueStatus(): Promise<void> {
  await postGuideWorkerMessage({ type: "GUIDE_QUEUE_STATUS_REQUEST" });
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
  workers.forEach((worker) => worker.postMessage(message));
  return workers.size > 0;
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
