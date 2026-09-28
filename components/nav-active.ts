// Keep the parent sidebar item active while viewing one of its child pages.
const MOVED_SECTIONS: Record<string, string> = {
  "/notifications": "/broadcasts",
  "/reviews": "/reports",
  "/vouchers": "/marketing",
  "/settings/chat-faq": "/ai-usage",
  "/privacy/data-requests": "/settings",
};

export function isNavItemActive(pathname: string, href: string, allHrefs: string[]): boolean {
  const section = Object.entries(MOVED_SECTIONS).find(([path]) => pathname === path || pathname.startsWith(path + "/"));
  const activePath = section ? section[1] : pathname;
  if (href === "/") return activePath === "/";
  const matches = activePath === href || activePath.startsWith(href + "/");
  if (!matches) return false;
  const hasMoreSpecificMatch = allHrefs.some((other) => {
    if (other === href || other.length <= href.length) return false;
    return activePath === other || activePath.startsWith(other + "/");
  });
  return !hasMoreSpecificMatch;
}
