import { describe, expect, it, vi } from "vitest";
import { sourceFunction, sourceHandler } from "../helpers/source-handler";

const photoUrls = ["https://photos.fixture.invalid/one", "https://photos.fixture.invalid/two"];
const slot = { id: "slot-a", tours: { name: "Walk" }, start_time: "2026-09-10T12:00:00Z" };

function photoFixture(options: { failQuery?: string; responses?: Response[]; bookings?: any[] } = {}) {
  const state: Record<string, any> = {};
  const saved: any[] = [];
  const setters = Object.fromEntries(["Sending", "Result", "SendProgress", "Urls", "SelectedSlot"].map(key => ["set" + key, vi.fn(value => { state[key] = value; })]));
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    expect(saved).toHaveLength(2);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer signed-in-a");
    return options.responses?.shift() || Response.json({ ok: true });
  });
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { access_token: "signed-in-a" } } }) },
    from(table: string) {
      const filters: any[] = [];
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        in: () => query,
        insert: async (rows: any[]) => {
          if (options.failQuery === table) return { error: { message: "Database unavailable" } };
          saved.push(...rows);
          return { error: null };
        },
        then: (yes: any, no: any) => {
          expect(filters).toEqual([["business_id", "a"], ["slot_id", "slot-a"]]);
          return Promise.resolve(options.failQuery === table ? { data: null, error: { message: "Database unavailable" } } : {
            data: options.bookings || [{ customer_name: "Guest A", phone: "27000000001", email: "guest@fixture.invalid" }], error: null,
          }).then(yes, no);
        },
      };
      return query;
    },
  };
  const send = sourceFunction("components/photos/TripPhotosWorkspace.tsx", "sendPhotos", {
    supabase, fetch, ...setters, SU: "https://fixture.invalid", selectedSlot: slot, sending: false, isGuide: false,
    urls: [" " + photoUrls[0] + " ", photoUrls[1], photoUrls[0]], businessId: "a",
    notify: vi.fn(), confirmAction: async () => true, loadHistory: vi.fn(),
  });
  return { send, fetch, saved, state };
}

describe("trip photo delivery", () => {
  it("saves every link for this operator and trip before sending, and counts each booker once", async () => {
    const f = photoFixture();
    await f.send();
    expect(f.saved).toEqual(photoUrls.map(photo_url => ({ business_id: "a", slot_id: "slot-a", photo_url })));
    expect(f.state.Result).toEqual({ sent: 1, failures: [] });
    expect(f.state.Sending).toBe(false);
    const whatsapp = JSON.parse(f.fetch.mock.calls[0][1].body as string);
    const email = JSON.parse(f.fetch.mock.calls[1][1].body as string);
    for (const url of photoUrls) expect(whatsapp.message).toContain(url);
    expect(whatsapp.message).not.toContain("Reply YES");
    expect(email.data).toMatchObject({ business_id: "a", photo_urls: photoUrls });
  });

  it.each([401, 200])("does not count HTTP %s errors as a successful delivery", async status => {
    const f = photoFixture({ responses: [Response.json({ ok: false, error: "Unauthorized" }, { status }), Response.json({ ok: false, error: "invalid_email" })] });
    await f.send();
    expect(f.state.Result).toEqual({ sent: 0, failures: ["Guest A (WhatsApp)", "Guest A (email)"] });
    expect(f.state.SelectedSlot).toBeUndefined();
  });

  it("reports a failed WhatsApp send even when the email succeeds", async () => {
    const f = photoFixture({ responses: [Response.json({ ok: false, error: "Window closed" })] });
    await f.send();
    expect(f.state.Result).toEqual({ sent: 1, failures: ["Guest A (WhatsApp)"] });
  });

  it.each(["bookings", "trip_photos"])("sends nothing when the %s query fails", async failQuery => {
    const f = photoFixture({ failQuery });
    await f.send();
    expect(f.state.Result.error).toBeTruthy();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("does not count a customer without contact details as notified", async () => {
    const f = photoFixture({ bookings: [{ customer_name: "Guest B" }] });
    await f.send();
    expect(f.state.Result).toEqual({ sent: 0, failures: ["Guest B (no contact details)"] });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("keeps failed Drive files selected and preserves the earlier folder on retry", async () => {
    const files = [new File(["first"], "first.jpg"), new File(["second"], "second.jpg")];
    const state: any = { Urls: [photoUrls[0]] };
    const setters = Object.fromEntries(["Uploading", "UploadProgress", "UploadedFolderUrl", "Urls", "UploadFiles"].map(key => ["set" + key, (value: any) => { state[key] = typeof value === "function" ? value(state[key]) : value; }]));
    const notify = vi.fn();
    const uploadDriveMedia = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Drive rejected the file"));
    const upload = sourceFunction("components/photos/TripPhotosWorkspace.tsx", "uploadToDrive", {
      ...setters, notify, selectedSlot: slot, uploadFiles: files, uploading: false, businessId: "a", uploadDriveMedia, isGuide: false,
      fmtDate: () => "10 Sep", loadHistory: vi.fn(),
      supabase: {
        functions: { invoke: async (_name: string, { body }: any) => ({ data: body.action === "token" ? { access_token: "fixture" } : { folder_id: "folder-two", folder_url: photoUrls[1] } }) },
        from: () => ({ insert: async () => ({ error: null }) }),
      },
    });
    await upload();
    expect(uploadDriveMedia).toHaveBeenNthCalledWith(1, files[0], "fixture", "folder-two");
    expect(uploadDriveMedia).toHaveBeenNthCalledWith(2, files[1], "fixture", "folder-two");
    expect(state.UploadFiles).toEqual([files[1]]);
    expect(state.Urls).toEqual(photoUrls);
    expect(state.Uploading).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: "error", message: "1 of 2 files uploaded. Failed files remain selected for retry." }));
  });
});

describe("shared guide photo sending", () => {
  it("uses the same confirmation and displays partial delivery without clearing the links", async () => {
    const state: Record<string, any> = {};
    const guideRequest = vi.fn(async () => ({ sent: 1, failures: ["Guest B (email)"] }));
    const setters = Object.fromEntries(["Sending", "Result", "SendProgress", "Urls", "SelectedSlot"].map(key => ["set" + key, (value: unknown) => { state[key] = value; }]));
    const confirmAction = vi.fn(async () => true);
    const send = sourceFunction("components/photos/TripPhotosWorkspace.tsx", "sendPhotos", {
      ...setters, isGuide: true, selectedSlot: slot, sending: false, urls: photoUrls, guideRequest, confirmAction, loadHistory: vi.fn(), notify: vi.fn(),
    });
    await send();
    expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Send now" }));
    expect(guideRequest).toHaveBeenCalledWith("/api/guide/send-thank-you", { slot_id: slot.id, photo_urls: photoUrls });
    expect(state.Result).toEqual({ sent: 1, failures: ["Guest B (email)"] });
    expect(state.Urls).toBeUndefined(); expect(state.Sending).toBe(false);
  });
});

it("the guide email uses every photo from this trip and reports provider rejection", async () => {
  const rows: Record<string, any[]> = {
    slots: [{ id: slot.id, business_id: "a", tours: slot.tours }],
    bookings: [{ slot_id: slot.id, business_id: "a", id: "booking-a", email: "guest@fixture.invalid" }],
    trip_photos: [
      ...photoUrls.map(photo_url => ({ slot_id: slot.id, business_id: "a", photo_url })),
      { slot_id: "other-slot", business_id: "a", photo_url: "https://other-trip.invalid" },
      { slot_id: slot.id, business_id: "b", photo_url: "https://other-operator.invalid" },
    ],
  };
  const db = { from(table: string) {
    const filters: any[] = [];
    const finish = async () => ({ data: (rows[table] || []).filter(row => filters.every(([key, value]) => row[key] === value)), error: null });
    const q: any = { select: () => q, eq: (key: string, value: any) => { filters.push([key, value]); return q; }, in: () => q, insert: () => q,
      maybeSingle: async () => ({ data: (await finish()).data[0] }), then: (yes: any, no: any) => finish().then(yes, no) };
    return q;
  } };
  const handler = sourceHandler("app/api/guide/send-thank-you/route.ts", {
    "@/app/lib/api-auth": { getCallerAdmin: async () => ({ business_id: "a", id: "guide-a" }) },
    "@supabase/supabase-js": { createClient: () => db },
    "@/app/lib/guide-api-auth": { getCallerGuide: async () => null },
  }, {}, async (_url, init) => {
    expect(JSON.parse(init!.body as string).data).toMatchObject({ business_id: "a", photo_urls: photoUrls });
    return Response.json({ ok: false, error: "invalid_email" });
  });
  const response = await handler(new Request("https://fixture.invalid/api/guide/send-thank-you", { method: "POST", body: JSON.stringify({ slot_id: slot.id }) }));
  expect(await response.json()).toMatchObject({ ok: false, recipient_count: 0, failed: [{ booking_id: "booking-a", error: "invalid_email" }] });
});
