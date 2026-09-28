self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Use a generic alert. */ }
  const url = typeof data.url === "string" && data.url.startsWith("/inbox") ? data.url : "/inbox";
  event.waitUntil(self.registration.showNotification("Guest message needs a reply", {
    body: "Open your BookingTours Inbox to respond.",
    icon: "/icon.png",
    badge: "/icon.png",
    tag: typeof data.tag === "string" ? data.tag : "web-chat",
    renotify: true,
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/inbox", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      await existing.navigate(url);
      return existing.focus();
    }
    return self.clients.openWindow(url);
  })());
});
