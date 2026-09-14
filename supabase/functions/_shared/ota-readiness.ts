// These adapters have not been validated against supplier connectivity contracts.
// Do not replace this with an operator toggle or environment-variable bypass.
// Release each provider only after partner access, contract implementation and
// certification. See docs/OTA_DIRECT_CONNECTIVITY.md.
export const OTA_DIRECT_CONNECTIONS_AVAILABLE: boolean = false;
export const OTA_UNAVAILABLE_MESSAGE = "Direct Viator and GetYourGuide connections are not available yet. BookingTours needs connectivity-partner approval, validated supplier API adapters and certification. Saved mappings do not activate a connection.";

export function otaUnavailableResponse(headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ok: false, code: "OTA_NOT_READY", error: OTA_UNAVAILABLE_MESSAGE }), {
    status: 503,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
