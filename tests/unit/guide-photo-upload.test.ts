import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sourceExports, sourceFunction, sourceHandler } from "../helpers/source-handler";

const SLOT_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = "22222222-2222-4222-8222-222222222222";
const BUSINESS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUSINESS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4_500_000;
const READ_TIMEOUT_MS = 15_000;

let pngBytes: Uint8Array;
let truncatedPngBytes: Uint8Array;
let avifBytes: Uint8Array;
let phoneJpegBytes: Uint8Array;
let excessPixelJpegBytes: Uint8Array;

beforeAll(async () => {
  pngBytes = new Uint8Array(await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#d9822f" },
  }).png().toBuffer());
  truncatedPngBytes = pngBytes.slice(0, -20);
  expect((await sharp(Buffer.from(truncatedPngBytes)).metadata()).format).toBe("png");
  await expect(sharp(Buffer.from(truncatedPngBytes)).stats()).rejects.toThrow();
  avifBytes = new Uint8Array(await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#2a5a52" },
  }).avif().toBuffer());
  phoneJpegBytes = new Uint8Array(await sharp({
    create: { width: 3024, height: 4032, channels: 3, background: "#2a5a52" },
  }).jpeg().toBuffer());
  excessPixelJpegBytes = new Uint8Array(await sharp({
    create: { width: 6400, height: 6400, channels: 3, background: "#d9822f" },
  }).jpeg({ quality: 10 }).toBuffer());
});

function imageFile(bytes: Uint8Array, options: { name?: string; type?: string } = {}) {
  return new File([bytes], options.name ?? "trip.jpg", { type: options.type ?? "image/jpeg" });
}

function requestFor(file: File, options: { declaredLength?: string; extraBytes?: number; duplicateFile?: boolean; duplicateOperation?: boolean; extraField?: boolean; operationId?: string } = {}) {
  const form = new FormData();
  form.append("slot_id", SLOT_ID);
  form.append("operation_id", options.operationId ?? OPERATION_ID);
  if (options.duplicateOperation) form.append("operation_id", options.operationId ?? OPERATION_ID);
  form.append("file", file);
  if (options.duplicateFile) form.append("file", file);
  if (options.extraField) form.append("unexpected", "value");
  if (options.extraBytes) form.append("ignored", new Blob([new Uint8Array(options.extraBytes)]), "ignored.bin");
  const request = new Request("https://fixture.invalid/api/guide/photo-upload", { method: "POST", body: form });
  if (options.declaredLength !== undefined) request.headers.set("content-length", options.declaredLength);
  return request;
}

function streamedRequest(size: number, declaredLength?: string) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
  const headers = new Headers({ "content-type": "multipart/form-data; boundary=fixture" });
  if (declaredLength !== undefined) headers.set("content-length", declaredLength);
  return new Request("https://fixture.invalid/api/guide/photo-upload", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function fixture(options: {
  caller?: { id: string; business_id: string; role: string } | null;
  slotBusinessId?: string;
  tokenThrows?: boolean;
  tokenFailsAfter?: number;
  uploadThrows?: boolean;
  uploadStatus?: number;
  malformedUploadResponse?: boolean;
  insertError?: string;
  insertErrorCode?: string;
  insertThrows?: boolean;
  ledgerUpdateError?: boolean;
  reconciliationRow?: boolean;
  reconciliationError?: string;
  deleteOk?: boolean;
} = {}) {
  const caller = options.caller === undefined
    ? { id: "admin-a", business_id: BUSINESS_A, role: "OPERATOR" }
    : options.caller;
  const inserts: Record<string, unknown>[] = [];
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  const queriedTables: string[] = [];
  let tokenCalls = 0;
  let ledger: Record<string, unknown> | null = null;
  let savedPhoto: Record<string, unknown> | null = null;

  const db = {
    from(table: string) {
      queriedTables.push(table);
      if (table === "slots") {
        const query: any = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: { id: SLOT_ID, business_id: options.slotBusinessId ?? BUSINESS_A } }),
        };
        return query;
      }
      if (table === "trip_photos") {
        const query: any = {
          insert: async (row: Record<string, unknown>) => {
            inserts.push(row);
            if (options.insertThrows) throw new Error(options.insertError || "insert response lost");
            if (options.insertError) return { error: { message: options.insertError, code: options.insertErrorCode || "" } };
            savedPhoto = row;
            return { error: null };
          },
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: options.reconciliationRow ? { id: OPERATION_ID, gdrive_file_id: "drive-file-a" } : savedPhoto,
            error: options.reconciliationError ? { message: options.reconciliationError, code: "" } : null,
          }),
        };
        return query;
      }
      if (table === "guide_photo_uploads") {
        const query: any = {
          insert: async (row: Record<string, unknown>) => {
            if (ledger) return { error: { code: "23505" } };
            ledger = { ...row };
            return { error: null };
          },
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: ledger, error: null }),
          update: (patch: Record<string, unknown>) => {
            const updateQuery: any = {
              eq: () => updateQuery,
              then: (resolve: (value: unknown) => void) => {
                if (options.ledgerUpdateError && patch.state === "uploaded") {
                  resolve({ error: { code: "08006" } });
                  return;
                }
                if (ledger) Object.assign(ledger, patch);
                resolve({ error: null });
              },
            };
            return updateQuery;
          },
        };
        return query;
      }
      throw new Error("Unexpected table: " + table);
    },
  };

  const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url);
    fetchCalls.push({ url: href, init });
    if (href.endsWith("/functions/v1/google-drive")) {
      tokenCalls++;
      if (options.tokenThrows || (options.tokenFailsAfter && tokenCalls > options.tokenFailsAfter)) throw new Error("token response lost");
      return Response.json({ access_token: "drive-token-a", folder_id: "folder-a" });
    }
    if (init.method === "DELETE") {
      return options.deleteOk === false
        ? Response.json({ error: { message: "delete denied SECRET_SENTINEL" } }, { status: 503 })
        : new Response(null, { status: 204 });
    }
    if (href.startsWith("https://www.googleapis.com/upload/drive/")) {
      if (options.uploadThrows) throw new Error("upload response lost SECRET_SENTINEL");
      if (options.malformedUploadResponse) return new Response("not-json SECRET_SENTINEL", { status: 200 });
      if (options.uploadStatus) {
        return Response.json({ error: { message: "upload denied SECRET_SENTINEL" } }, { status: options.uploadStatus });
      }
      return Response.json({ id: "drive-file-a", webViewLink: "https://drive.invalid/a" });
    }
    throw new Error("Unexpected fetch: " + href);
  });

  const handler = sourceHandler("app/api/guide/photo-upload/route.ts", {
    "@/app/lib/api-auth": { getCallerAdmin: async () => caller },
    "@supabase/supabase-js": { createClient: () => db },
    sharp: { default: (input: Uint8Array, sharpOptions: Parameters<typeof sharp>[1]) => sharp(Buffer.from(input), sharpOptions) },
  }, {}, fetchImpl as typeof fetch);

  return { handler, inserts, fetchCalls, fetchImpl, queriedTables, get ledger() { return ledger; }, get tokenCalls() { return tokenCalls; } };
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

describe("guide photo upload boundary", () => {
  it("causes no database or provider effect without an authenticated administrator", async () => {
    const f = fixture({ caller: null });
    const response = await f.handler(requestFor(imageFile(pngBytes, { type: "image/png" })));
    expect(response.status).toBe(401);
    expect(f.queriedTables).toEqual([]);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("causes no provider effect for a foreign-tenant slot", async () => {
    const f = fixture({ slotBusinessId: BUSINESS_B });
    const response = await f.handler(requestFor(imageFile(pngBytes, { type: "image/png" })));
    expect(response.status).toBe(403);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.inserts).toEqual([]);
  });

  it("rejects an oversized declared request before database or provider access", async () => {
    const f = fixture();
    const request = requestFor(imageFile(pngBytes, { type: "image/png" }), {
      declaredLength: String(MAX_REQUEST_BYTES + 1),
    });
    const response = await f.handler(request);
    expect(response.status).toBe(413);
    expect(f.queriedTables).toEqual([]);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([undefined, "1"])("bounds actual streamed bytes with declared length %s", async (declaredLength) => {
    const f = fixture();
    const response = await f.handler(streamedRequest(MAX_REQUEST_BYTES + 1, declaredLength));
    expect(response.status).toBe(413);
    expect(f.queriedTables).toEqual([]);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("ends a stalled request read without touching DB or provider", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      const request = new Request("https://fixture.invalid/api/guide/photo-upload", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=fixture" },
        body: new ReadableStream<Uint8Array>({ start() {} }),
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      const pending = f.handler(request);
      await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1);
      expect((await pending).status).toBe(408);
      expect(f.queriedTables).toEqual([]);
      expect(f.fetchImpl).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("counts ignored multipart fields toward the request limit", async () => {
    const f = fixture();
    const request = requestFor(imageFile(pngBytes, { type: "image/png" }), { extraBytes: MAX_REQUEST_BYTES });
    request.headers.delete("content-length");
    const response = await f.handler(request);
    expect(response.status).toBe(413);
    expect(f.queriedTables).toEqual([]);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized file before tenant credentials or upload", async () => {
    const f = fixture();
    const file = imageFile(new Uint8Array(MAX_PHOTO_BYTES + 1), { type: "image/png" });
    const response = await f.handler(requestFor(file));
    expect(response.status).toBe(413);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects duplicate file fields", async () => {
    const f = fixture();
    const response = await f.handler(requestFor(imageFile(pngBytes, { type: "image/png" }), { duplicateFile: true }));
    expect(response.status).toBe(400);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate operation", { duplicateOperation: true }],
    ["unexpected field", { extraField: true }],
  ])("rejects %s before provider access", async (_label, options) => {
    const f = fixture();
    const response = await f.handler(requestFor(imageFile(pngBytes, { type: "image/png" }), options));
    expect(response.status).toBe(400);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a text field masquerading as a file", async () => {
    const form = new FormData();
    form.append("slot_id", SLOT_ID);
    form.append("operation_id", OPERATION_ID);
    form.append("file", "<html>not a photo</html>");
    const f = fixture();
    const response = await f.handler(new Request("https://fixture.invalid/api/guide/photo-upload", { method: "POST", body: form }));
    expect(response.status).toBe(400);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", new Uint8Array(), "image/png"],
    ["malformed", new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]), "image/jpeg"],
    ["HTML declared JPEG", new TextEncoder().encode("<html><script>alert(1)</script></html>"), "image/jpeg"],
    ["header-valid truncated", () => truncatedPngBytes, "image/png"],
    ["active SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), "image/svg+xml"],
    ["unverified HEIC", new TextEncoder().encode("....ftypheic....mdat"), "image/heic"],
  ])("rejects %s content before requesting Drive credentials", async (_label, value, mime) => {
    const bytes = typeof value === "function" ? value() : value;
    const f = fixture();
    const response = await f.handler(requestFor(imageFile(bytes, { type: mime })));
    expect([400, 415]).toContain(response.status);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.inserts).toEqual([]);
  });

  it("rejects a declared MIME type that disagrees with decoded bytes", async () => {
    const f = fixture();
    const response = await f.handler(requestFor(imageFile(pngBytes, { type: "image/jpeg" })));
    expect(response.status).toBe(415);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a real phone-size JPEG and rejects an image above the pixel limit", async () => {
    const approved = fixture();
    expect((await approved.handler(requestFor(imageFile(phoneJpegBytes, { type: "image/jpeg" })))).status).toBe(200);
    const oversized = fixture();
    expect((await oversized.handler(requestFor(imageFile(excessPixelJpegBytes, { type: "image/jpeg" })))).status).toBe(415);
    expect(oversized.fetchImpl).not.toHaveBeenCalled();
  });

  it("uploads fully decoded bytes under a generated safe name and verified tenant", async () => {
    const f = fixture();
    const file = imageFile(pngBytes, { name: "../../guest<script>.jpg", type: "image/png" });
    const response = await f.handler(requestFor(file));
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ ok: true });
    expect(f.fetchCalls).toHaveLength(2);
    const upload = f.fetchCalls[1];
    expect(new Headers(upload.init.headers).get("authorization")).toBe("Bearer drive-token-a");
    const multipart = new TextDecoder().decode(upload.init.body as Uint8Array);
    expect(multipart).toContain("Content-Type: image/jpeg");
    expect(multipart).toContain(SLOT_ID.slice(0, 8) + "_" + OPERATION_ID + ".jpg");
    expect(multipart).toContain('"guide_photo_operation":"' + OPERATION_ID + '"');
    expect(multipart).not.toContain("guest<script>");
    const payload = Buffer.from(upload.init.body as Uint8Array);
    const marker = Buffer.from("Content-Type: image/jpeg\r\n\r\n");
    const start = payload.indexOf(marker) + marker.length;
    const end = payload.lastIndexOf(Buffer.from("\r\n------GuidePWA"));
    expect(start).toBeGreaterThan(marker.length - 1);
    expect(end).toBeGreaterThan(start);
    expect((await sharp(payload.subarray(start, end)).metadata()).format).toBe("jpeg");
    expect(f.inserts).toEqual([expect.objectContaining({
      business_id: BUSINESS_A,
      slot_id: SLOT_ID,
      gdrive_file_id: "drive-file-a",
      uploaded_by_admin_id: "admin-a",
    })]);
  });

  it("decodes AVIF and sends a safe JPEG", async () => {
    const f = fixture();
    const response = await f.handler(requestFor(imageFile(avifBytes, { name: "capture.heic", type: "image/avif" })));
    expect(response.status).toBe(200);
    const multipart = new TextDecoder().decode(f.fetchCalls[1].init.body as Uint8Array);
    expect(multipart).toContain("Content-Type: image/jpeg");
    expect(multipart).toContain("11111111_" + OPERATION_ID + ".jpg");
  });

  it("accepts valid decoded image bytes when a browser omits the MIME declaration", async () => {
    const f = fixture();
    const response = await f.handler(requestFor(imageFile(pngBytes, { name: "capture", type: "" })));
    expect(response.status).toBe(200);
    const multipart = new TextDecoder().decode(f.fetchCalls[1].init.body as Uint8Array);
    expect(multipart).toContain("Content-Type: image/jpeg");
  });

  it("returns the first saved photo on a stable retry without another Drive upload", async () => {
    const f = fixture({ tokenFailsAfter: 1 });
    const file = imageFile(pngBytes, { type: "image/png" });
    expect((await f.handler(requestFor(file))).status).toBe(200);
    const retry = await f.handler(requestFor(file));
    expect(retry.status).toBe(200);
    expect(await body(retry)).toMatchObject({ ok: true, recovered: true });
    expect(f.fetchCalls.filter(call => call.url.includes("/upload/drive/"))).toHaveLength(1);
    expect(f.tokenCalls).toBe(1);
    expect(f.inserts).toHaveLength(1);
  });

  it("does not repeat an upload after a lost Drive response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture({ uploadThrows: true });
    const file = imageFile(pngBytes, { type: "image/png" });
    expect((await f.handler(requestFor(file))).status).toBe(503);
    const retry = await f.handler(requestFor(file));
    expect(retry.status).toBe(503);
    expect(await body(retry)).toMatchObject({ code: "UPLOAD_STATE_UNKNOWN", retryable: false });
    expect(f.fetchCalls.filter(call => call.url.includes("/upload/drive/"))).toHaveLength(1);
    expect(f.ledger).toMatchObject({ operation_id: OPERATION_ID, state: "uploading" });
    log.mockRestore();
  });

  it("checks an unresolved ledger claim before a later token failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture({ uploadThrows: true, tokenFailsAfter: 1 });
    const file = imageFile(pngBytes, { type: "image/png" });
    expect((await f.handler(requestFor(file))).status).toBe(503);
    expect((await f.handler(requestFor(file))).status).toBe(503);
    expect(f.tokenCalls).toBe(1);
    expect(f.fetchCalls.filter(call => call.url.includes("/upload/drive/"))).toHaveLength(1);
    log.mockRestore();
  });

  it("does not create a photo row or repeat Drive upload when recording its file ID fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture({ ledgerUpdateError: true });
    const file = imageFile(pngBytes, { type: "image/png" });
    expect((await f.handler(requestFor(file))).status).toBe(503);
    expect((await f.handler(requestFor(file))).status).toBe(503);
    expect(f.fetchCalls.filter(call => call.url.includes("/upload/drive/"))).toHaveLength(1);
    expect(f.inserts).toEqual([]);
    expect(f.ledger).toMatchObject({ state: "uploading" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("GUIDE_PHOTO_LEDGER_UPDATE_UNKNOWN"));
    log.mockRestore();
  });

  it("does not repeat Drive upload while a photo insert outcome is unknown", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture({ insertError: "synthetic transport loss", insertErrorCode: "08006" });
    const file = imageFile(pngBytes, { type: "image/png" });
    expect((await f.handler(requestFor(file))).status).toBe(503);
    expect((await f.handler(requestFor(file))).status).toBe(503);
    expect(f.fetchCalls.filter(call => call.url.includes("/upload/drive/"))).toHaveLength(1);
    expect(f.ledger).toMatchObject({ state: "uploaded", drive_file_id: "drive-file-a" });
    log.mockRestore();
  });

  it("rejects reuse of an operation ID with different image content", async () => {
    const f = fixture();
    expect((await f.handler(requestFor(imageFile(pngBytes, { type: "image/png" })))).status).toBe(200);
    const retry = await f.handler(requestFor(imageFile(avifBytes, { type: "image/avif" })));
    expect(retry.status).toBe(409);
    expect(f.fetchCalls.filter(call => call.url.includes("/upload/drive/"))).toHaveLength(1);
  });

  it("reports a definite provider rejection without creating a photo record", async () => {
    const f = fixture({ uploadStatus: 400 });
    const response = await f.handler(requestFor(imageFile(pngBytes, { type: "image/png" })));
    expect(response.status).toBe(502);
    expect(await body(response)).toMatchObject({ retryable: true });
    expect(f.inserts).toEqual([]);
  });

  it.each([
    ["transport loss", { uploadThrows: true }],
    ["provider 503", { uploadStatus: 503 }],
    ["malformed success response", { malformedUploadResponse: true }],
  ])("does not invite a blind retry after %s", async (_label, options) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture(options);
    const response = await f.handler(requestFor(imageFile(pngBytes, { type: "image/png" })));
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ code: "UPLOAD_STATE_UNKNOWN", retryable: false });
    expect(f.inserts).toEqual([]);
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).not.toContain("SECRET_SENTINEL");
    log.mockRestore();
  });

  it.each([true, false])("compensates only a definite database rejection (cleanup ok: %s)", async (deleteOk) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture({ insertError: "constraint detail SECRET_SENTINEL", insertErrorCode: "23514", deleteOk });
    const response = await f.handler(requestFor(imageFile(pngBytes, { type: "image/png" })));
    expect(response.status).toBe(deleteOk ? 500 : 503);
    expect(f.fetchCalls).toHaveLength(3);
    expect(f.fetchCalls[2]).toMatchObject({
      url: "https://www.googleapis.com/drive/v3/files/drive-file-a",
      init: { method: "DELETE" },
    });
    const result = await body(response);
    expect(result.retryable).toBe(deleteOk);
    if (deleteOk) expect(log).not.toHaveBeenCalled();
    else expect(log).toHaveBeenCalledWith(expect.stringContaining("GUIDE_PHOTO_COMPENSATION_FAILED"));
    expect(log.mock.calls.flat().join(" ")).not.toContain("SECRET_SENTINEL");
    log.mockRestore();
  });

  it("returns success without deleting when an uncertain insert is found during reconciliation", async () => {
    const f = fixture({ insertError: "response interrupted", reconciliationRow: true });
    const response = await f.handler(requestFor(imageFile(pngBytes, { type: "image/png" })));
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ ok: true, recovered: true });
    expect(f.fetchCalls).toHaveLength(2);
  });

  it.each([
    ["empty reconciliation read", { insertError: "response interrupted" }],
    ["failed reconciliation read", { insertError: "response interrupted", reconciliationError: "lookup unavailable" }],
    ["thrown insert and empty read", { insertThrows: true }],
    ["database connection loss and empty read", { insertError: "connection lost", insertErrorCode: "08006" }],
  ])("does not delete or invite a retry after %s", async (_label, options) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture(options);
    const response = await f.handler(requestFor(imageFile(pngBytes, { type: "image/png" })));
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({ code: "UPLOAD_STATE_UNKNOWN", retryable: false });
    expect(f.fetchCalls).toHaveLength(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("GUIDE_PHOTO_PERSISTENCE_UNKNOWN"));
    expect(log.mock.calls.flat().join(" ")).not.toContain("SECRET_SENTINEL");
    log.mockRestore();
  });
});

describe("guide photo upload caller", () => {
  function storage() {
    const rows = new Map<string, string>();
    return {
      rows,
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => { rows.set(key, value); },
      removeItem: (key: string) => { rows.delete(key); },
      key: (index: number) => [...rows.keys()][index] ?? null,
      get length() { return rows.size; },
    };
  }
  function callerFixture(fetchImpl: typeof fetch, saved = storage(), userId = "user-a", businessId = BUSINESS_A) {
    const setUploadStatus = vi.fn();
    const file = "app/guide/photos/[slotId]/page.tsx";
    const persistedOperationId = sourceFunction(file, "persistedOperationId", { localStorage: saved });
    const clearOperation = sourceFunction(file, "clearOperation", { localStorage: saved });
    const upload = sourceFunction("app/guide/photos/[slotId]/page.tsx", "onPickPhotos", {
      getAuthHeaders: async () => ({ Authorization: "Bearer signed-in-guide", "Content-Type": "application/json" }),
      uploading: false,
      slotId: SLOT_ID,
      businessId,
      supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: userId } } } }) } },
      persistedOperationId,
      clearOperation,
      FormData,
      setUploading: vi.fn(),
      setUploadStatus,
      setProgress: vi.fn(),
      reload: vi.fn(),
      fetch: fetchImpl,
    });
    return { upload, setUploadStatus, saved };
  }

  it("does not invite a blind retry when the server cannot reconcile persistence", async () => {
    const f = callerFixture(async () => Response.json({
      error: "Upload outcome could not be confirmed. Check the gallery before retrying.",
      code: "UPLOAD_STATE_UNKNOWN",
      retryable: false,
    }, { status: 503 }));
    await f.upload([imageFile(pngBytes, { name: "trip.png", type: "image/png" })]);
    expect(f.setUploadStatus).toHaveBeenLastCalledWith(
      "0 of 1 photos uploaded. Outcome unknown for trip.png. Check the gallery or ask an admin before uploading again.",
    );
  });

  it.each([
    ["browser response loss", async () => { throw new Error("connection closed"); }],
    ["unreadable server response", async () => new Response("not json", { status: 200 })],
  ])("treats %s as unknown rather than retryable", async (_label, fetchImpl) => {
    const f = callerFixture(fetchImpl as typeof fetch);
    await f.upload([imageFile(pngBytes, { name: "trip.png", type: "image/png" })]);
    expect(f.setUploadStatus).toHaveBeenLastCalledWith(
      "0 of 1 photos uploaded. Outcome unknown for trip.png. Check the gallery or ask an admin before uploading again.",
    );
  });

  it("keeps the same operation ID across an uncertain browser retry", async () => {
    const seen: string[] = [];
    const f = callerFixture(async (_url, init) => {
      seen.push(String((init?.body as FormData).get("operation_id")));
      throw new Error("synthetic response loss");
    });
    const file = imageFile(pngBytes, { name: "trip.png", type: "image/png" });
    await f.upload([file]);
    await f.upload([file]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(f.saved.rows.size).toBe(1);
  });

  it("survives a page remount and a transient token error with the same operation ID", async () => {
    const saved = storage();
    const seen: string[] = [];
    let attempt = 0;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(String((init?.body as FormData).get("operation_id")));
      attempt++;
      if (attempt === 1) return Response.json({ code: "UPLOAD_STATE_UNKNOWN", retryable: false }, { status: 503 });
      if (attempt === 2) return Response.json({ error: "temporary token failure", retryable: true }, { status: 502 });
      return Response.json({ ok: true });
    };
    const photo = imageFile(pngBytes, { name: "trip.png", type: "image/png" });
    await callerFixture(fetchImpl as typeof fetch, saved).upload([photo]);
    await callerFixture(fetchImpl as typeof fetch, saved).upload([photo]);
    expect(saved.rows.size).toBe(1);
    await callerFixture(fetchImpl as typeof fetch, saved).upload([photo]);
    expect(new Set(seen).size).toBe(1);
    expect(saved.rows.size).toBe(0);
  });

  it("blocks an account switch for an unresolved photo and scopes other operations by tenant, slot and bytes", async () => {
    const saved = storage();
    const persisted = sourceFunction("app/guide/photos/[slotId]/page.tsx", "persistedOperationId", { localStorage: saved });
    const photo = imageFile(pngBytes, { name: "trip.png", type: "image/png" });
    const other = imageFile(avifBytes, { name: "trip.png", type: "image/avif" });
    const first = await persisted(photo, BUSINESS_A, "user-a", SLOT_ID);
    expect((await persisted(photo, BUSINESS_A, "user-a", SLOT_ID)).id).toBe(first.id);
    await expect(persisted(photo, BUSINESS_A, "user-b", SLOT_ID)).rejects.toThrow("under another sign-in");
    expect((await persisted(photo, BUSINESS_B, "user-a", SLOT_ID)).id).not.toBe(first.id);
    expect((await persisted(photo, BUSINESS_A, "user-a", "44444444-4444-4444-8444-444444444444")).id).not.toBe(first.id);
    expect((await persisted(other, BUSINESS_A, "user-a", SLOT_ID)).id).not.toBe(first.id);
    expect([...saved.rows.keys()].join(" ")).not.toMatch(/user-a|user-b|aaaaaaaa|bbbbbbbb|trip.png/);
    expect([...saved.rows.values()].join(" ")).not.toMatch(/user-a|user-b|aaaaaaaa|bbbbbbbb|trip.png/);
  });

  it("does not contact the provider after an account switch on an unresolved photo", async () => {
    const saved = storage();
    const photo = imageFile(pngBytes, { type: "image/png" });
    const first = callerFixture(async () => Response.json({ code: "UPLOAD_STATE_UNKNOWN", retryable: false }, { status: 503 }), saved, "user-a");
    await first.upload([photo]);
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    const switched = callerFixture(fetchImpl as typeof fetch, saved, "user-b");
    await switched.upload([photo]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(switched.setUploadStatus).toHaveBeenLastCalledWith("This photo has an unresolved upload under another sign-in. Ask an admin before uploading it again.");
  });

  it.each(["read denied", "write full"])("stops before upload when durable browser storage is %s", async mode => {
    const saved = storage();
    if (mode === "read denied") saved.getItem = () => { throw new Error("disabled"); };
    else saved.setItem = () => { throw new Error("quota"); };
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    const f = callerFixture(fetchImpl as typeof fetch, saved);
    await f.upload([imageFile(pngBytes, { type: "image/png" })]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(f.setUploadStatus).toHaveBeenLastCalledWith("This browser cannot safely remember photo retries. Enable storage before uploading.");
  });

  it("keeps unresolved identities and stops adding new ones at the storage bound", async () => {
    const saved = storage();
    for (let i = 0; i < 100; i++) saved.rows.set("guide-photo-upload:v1:" + i, crypto.randomUUID());
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    const f = callerFixture(fetchImpl as typeof fetch, saved);
    await f.upload([imageFile(pngBytes, { type: "image/png" })]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(saved.rows.size).toBe(100);
    expect(f.setUploadStatus).toHaveBeenLastCalledWith("Too many unresolved photo uploads. Ask an admin to reconcile them before adding more.");
  });
});

describe("real shared caller gate used by guide uploads", () => {
  it.each([
    ["active operator", { suspended: false, read_only: false, subscription: "ACTIVE" }, true],
    ["read-only demo", { suspended: false, read_only: true, subscription: "ACTIVE" }, false],
    ["suspended admin", { suspended: true, read_only: false, subscription: "ACTIVE" }, false],
    ["suspended subscription", { suspended: false, read_only: false, subscription: "SUSPENDED" }, false],
  ])("%s", async (_label, account, allowed) => {
    const adminRow = { id: "33333333-3333-4333-8333-333333333333", role: "OPERATOR", business_id: BUSINESS_A,
      suspended: account.suspended, read_only: account.read_only };
    const db = {
      auth: { getUser: async () => ({ data: { user: { id: "user-a" } }, error: null }) },
      from(table: string) {
        const query: any = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: table === "admin_users" ? adminRow : { subscription_status: account.subscription }, error: null }),
        };
        return query;
      },
    };
    const auth = sourceExports("app/lib/api-auth.ts", {
      "@supabase/supabase-js": { createClient: () => db },
      "./role-utils": {},
    }).getCallerAdmin as (request: Request) => Promise<unknown>;
    const result = await auth(new Request("https://fixture.invalid/api/guide/photo-upload", {
      method: "POST", headers: { Authorization: "Bearer synthetic-user" },
    }));
    expect(Boolean(result)).toBe(allowed);
  });
});
