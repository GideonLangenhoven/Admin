// Keep the session fixed for this document. Crossing the guide/admin boundary
// requires a full navigation so in-flight work cannot change identities.
export function isGuideSessionPath(path: string): boolean {
  return path === "/guide-setup" || path === "/simpleguide" || path.startsWith("/simpleguide/");
}

export const guideSession = typeof window !== "undefined" && isGuideSessionPath(window.location.pathname);
export const sessionKey = (key: string) => guideSession ? "guide:" + key : key;
export const sessionCookie = (name: string) => guideSession ? "guide_" + name : name;
export const authStorage = {
  getItem: (key: string) => localStorage.getItem(sessionKey(key)),
  setItem: (key: string, value: string) => localStorage.setItem(sessionKey(key), value),
  removeItem: (key: string) => localStorage.removeItem(sessionKey(key)),
};

export const guideWorkerScope = guideSession ? "/guide/shared/" : "/guide/";
export const guideWorkerScript = guideSession ? "/guide/sw.js?session=guide" : "/guide/sw.js";
export const guideQueueAuthorityKey = sessionKey("guide-queue-authority-v2");
