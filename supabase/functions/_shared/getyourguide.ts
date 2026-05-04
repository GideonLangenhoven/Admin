// GetYourGuide Supplier API client — OAuth2 client-credentials flow
// Sandbox: https://supplier-api.sandbox.getyourguide.com
// Production: https://supplier-api.getyourguide.com

var PROD_BASE = "https://supplier-api.getyourguide.com";
var SANDBOX_BASE = "https://supplier-api.sandbox.getyourguide.com";

var tokenCache: Map<string, { token: string; expires: number }> = new Map();

export type GygClient = {
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  baseUrl: string;
  testMode: boolean;
};

async function getAccessToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  var cached = tokenCache.get(clientId);
  if (cached && cached.expires > Date.now()) return cached.token;

  var resp = await fetch(baseUrl + "/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    var errBody = await resp.text().catch(() => "");
    throw new Error("GYG OAuth2 token failed: " + resp.status + " " + errBody);
  }
  var data = await resp.json();
  var expiresIn = (data.expires_in || 3600) - 60;
  tokenCache.set(clientId, { token: data.access_token, expires: Date.now() + expiresIn * 1000 });
  return data.access_token;
}

export function createGygClient(opts: {
  clientId: string;
  clientSecret: string;
  testMode: boolean;
}): GygClient {
  var baseUrl = opts.testMode ? SANDBOX_BASE : PROD_BASE;

  var fetchFn = async (path: string, init: RequestInit = {}): Promise<Response> => {
    var token = await getAccessToken(baseUrl, opts.clientId, opts.clientSecret);
    var url = baseUrl + path;
    var headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
      ...(init.headers as Record<string, string> || {}),
    };
    return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
  };

  return { fetch: fetchFn, baseUrl, testMode: opts.testMode };
}

export async function gygPushAvailability(client: GygClient, payload: any): Promise<any> {
  var r = await client.fetch("/supplier/availability", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    var body = await r.text().catch(() => "");
    throw new Error("GYG availability push: " + r.status + " " + body);
  }
  return r.json();
}

export async function gygFetchBookings(client: GygClient, modifiedSince: string): Promise<any[]> {
  var r = await client.fetch("/supplier/bookings?modified_since=" + encodeURIComponent(modifiedSince));
  if (!r.ok) {
    var body = await r.text().catch(() => "");
    throw new Error("GYG fetch bookings: " + r.status + " " + body);
  }
  var data = await r.json();
  return data?.bookings || data?.data || [];
}
