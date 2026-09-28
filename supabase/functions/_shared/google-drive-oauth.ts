export function isAllowedDriveReturnOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && url.protocol === "https:" && (
      url.hostname === "admin.bookingtours.co.za" ||
      /^[a-z0-9-]+\.admin\.bookingtours\.co\.za$/.test(url.hostname) ||
      url.hostname === "caepweb-admin.vercel.app"
    );
  } catch {
    return false;
  }
}

export function driveCallbackUrl(returnOrigin: string, state: string, code: string | null, error: string | null): string {
  if (!isAllowedDriveReturnOrigin(returnOrigin)) throw new Error("Invalid operator return address");
  const destination = new URL("/google-callback", returnOrigin);
  destination.searchParams.set("state", state);
  if (code) destination.searchParams.set("code", code);
  if (error) destination.searchParams.set("error", error);
  return destination.href;
}
