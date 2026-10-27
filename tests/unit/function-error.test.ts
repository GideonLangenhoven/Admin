import { describe, it, expect, vi } from "vitest";
import { functionError } from "../../app/lib/function-error";

// supabase-js hands back a FunctionsHttpError whose context is the raw Response.
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify(body), { status }),
  }),
});

describe("functionError", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  it("returns null on success", async () => {
    expect(await functionError({ data: { ok: true, redirectUrl: "https://pay.example" }, error: null })).toBeNull();
  });

  it("shows the reason from a non-2xx body instead of the generic message", async () => {
    const res = httpError(409, { error: "CHECKOUT_UNAVAILABLE", reason: "Reservation expired. Please choose a time again." });
    expect(await functionError(res)).toBe("Reservation expired. Please choose a time again.");
  });

  it("shows a plain-language error field", async () => {
    expect(await functionError(httpError(409, { error: "Not enough spots available" }))).toBe("Not enough spots available");
  });

  it("never shows a bare error code", async () => {
    expect(await functionError(httpError(409, { error: "GUEST_COUNT_CHANGED" }), "Fallback")).toBe("Fallback");
  });

  it("never shows raw database text", async () => {
    const res = httpError(500, { error: 'new row violates row-level security policy for table "bookings"' });
    expect(await functionError(res, "Fallback")).toBe("Fallback");
  });

  it("treats a 200 with ok:false as a failure", async () => {
    expect(await functionError({ data: { ok: false, error: "Booking changed. Refresh before trying again." }, error: null }))
      .toBe("Booking changed. Refresh before trying again.");
  });

  it("falls back when the body is not JSON", async () => {
    const res = { data: null, error: Object.assign(new Error("x"), { context: new Response("<html>", { status: 502 }) }) };
    expect(await functionError(res, "Fallback")).toBe("Fallback");
  });
});
