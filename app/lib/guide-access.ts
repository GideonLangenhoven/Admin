// The operator's public alias is a username, never a destination for email.
export function guideAuthEmail(login: string): string | null {
  const match = /^guide@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/.exec(login.trim().toLowerCase());
  return match ? `guide+${match[1]}@guides.bookingtours.co.za` : null;
}

export function isGuidePath(path: string): boolean {
  return ["/simpleguide", "/simpleguide/check-ins"].includes(path) || /^\/(?:guide|simpleguide)\/photos\/[0-9a-f-]{36}$/i.test(path);
}
