// Viator Partner API client — supplier-side integration
// Auth: exp-api-key header per https://docs.viator.com/partner-api/technical/#section/Authentication
// Sandbox: https://api.sandbox.viator.com/partner
// Production: https://api.viator.com/partner

var PROD_BASE = "https://api.viator.com/partner";
var SANDBOX_BASE = "https://api.sandbox.viator.com/partner";

export type ViatorClient = {
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  baseUrl: string;
  testMode: boolean;
};

export function createViatorClient(opts: {
  apiKey: string;
  testMode: boolean;
}): ViatorClient {
  var baseUrl = opts.testMode ? SANDBOX_BASE : PROD_BASE;

  var fetchFn = async (path: string, init: RequestInit = {}): Promise<Response> => {
    var url = baseUrl + path;
    var headers: Record<string, string> = {
      "Accept": "application/json;version=2.0",
      "Accept-Language": "en-US",
      "Content-Type": "application/json",
      "exp-api-key": opts.apiKey,
      ...(init.headers as Record<string, string> || {}),
    };
    return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
  };

  return { fetch: fetchFn, baseUrl, testMode: opts.testMode };
}

export async function viatorPushAvailability(client: ViatorClient, payload: any): Promise<any> {
  var r = await client.fetch("/availability/schedules", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    var body = await r.text().catch(() => "");
    throw new Error("viator availability push: " + r.status + " " + body);
  }
  return r.json();
}
