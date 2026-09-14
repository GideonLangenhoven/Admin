// Shared active-tab logic for the admin sidebar (desktop rail, mobile bottom
// nav, mobile drawer). A plain "pathname starts with href" prefix match makes
// a parent route (e.g. /settings) and a more specific sibling route in the
// same nav array (e.g. /settings/chat-faq) both light up at once whenever the
// specific one is active. This picks the single most specific match.
export function isNavItemActive(pathname: string, href: string, allHrefs: string[]): boolean {
  if (href === "/") return pathname === "/";
  const matches = pathname === href || pathname.startsWith(href + "/");
  if (!matches) return false;
  const hasMoreSpecificMatch = allHrefs.some((other) => {
    if (other === href || other.length <= href.length) return false;
    return pathname === other || pathname.startsWith(other + "/");
  });
  return !hasMoreSpecificMatch;
}
