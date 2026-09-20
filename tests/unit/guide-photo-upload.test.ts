import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sourceFunction, sourceHandler } from "../helpers/source-handler";

const SLOT_ID = "11111111-1111-4111-8111-111111111111";
const BUSINESS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUSINESS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4_500_000;

let pngBytes: Uint8Array;
let truncatedPngBytes: Uint8Array;
let avifBytes: Uint8Array;

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
});

function imageFile(bytes: Uint8Array, options: { name?: string; type?: string } = {}) {
  return new File([bytes], options.name ?? "trip.jpg", { type: options.type ?? "image/jpeg" });
}

function requestFor(file: File, options: { declaredLength?: string; extraBytes?: number; duplicateFile?: boolean } = {}) {
  const form = new FormData();
  form.append("slot_id", SLOT_ID);
  form.append("file", file);
  if (options.duplicateFile) form.append("file", file);
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
  uploadThrows?: boolean;
  uploadStatus?: number;
  malformedUploadResponse?: boolean;
  insertError?: string;
  insertErrorCode?: string;
  insertThrows?: boolean;
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
            return { error: options.insertError ? { message: options.insertError, code: options.insertErrorCode || "" } : null };
          },
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: options.reconciliationRow ? { id: "photo-a" } : null,
            error: options.reconciliationError ? { message: options.reconciliationError, code: "" } : null,
          }),
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
      if (options.tokenThrows) throw new Error("token response lost");
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
    sharp: { default: (input: Uint8Array, sharpOptions: sharp.SharpOptions) => sharp(Buffer.from(input), sharpOptions) },
  }, {}, fetchImpl as typeof fetch);

  return { handler, inserts, fetchCalls, fetchImpl, queriedTables };
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
    ["empty", new Uint8Array(), "image/png"],
    ["malformed", new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]), "image/jpeg"],
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
    expect(multipart).toContain("Content-Type: image/png");
    expect(multipart).toMatch(new RegExp(SLOT_ID.slice(0, 8) + "_[0-9a-f-]{36}\\.png"));
    expect(multipart).not.toContain("guest<script>");
    expect(f.inserts).toEqual([expect.objectContaining({
      business_id: BUSINESS_A,
      slot_id: SLOT_ID,
      gdrive_file_id: "drive-file-a",
      uploaded_by_admin_id: "admin-a",
    })]);
  });

  it("preserves AVIF as AVIF based on decoded content", async () => {
    const f = fixture();
    const response = await f.handler(requestFor(imageFile(avifBytes, { name: "capture.heic", type: "image/avif" })));
    expect(response.status).toBe(200);
    const multipart = new TextDecoder().decode(f.fetchCalls[1].init.body as Uint8Array);
    expect(multipart).toContain("Content-Type: image/avif");
    expect(multipart).toMatch(/11111111_[0-9a-f-]{36}\.avif/);
  });

  it("accepts valid decoded image bytes when a browser omits the MIME declaration", async () => {
    const f = fixture();
    const response = await f.handler(requestFor(imageFile(pngBytes, { name: "capture", type: "" })));
    expect(response.status).toBe(200);
    const multipart = new TextDecoder().decode(f.fetchCalls[1].init.body as Uint8Array);
    expect(multipart).toContain("Content-Type: image/png");
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
  function callerFixture(fetchImpl: typeof fetch) {
    const setUploadStatus = vi.fn();
    const upload = sourceFunction("app/guide/photos/[slotId]/page.tsx", "onPickPhotos", {
      getAuthHeaders: async () => ({ Authorization: "Bearer signed-in-guide", "Content-Type": "application/json" }),
      uploading: false,
      slotId: SLOT_ID,
      FormData,
      setUploading: vi.fn(),
      setUploadStatus,
      setProgress: vi.fn(),
      reload: vi.fn(),
      fetch: fetchImpl,
    });
    return { upload, setUploadStatus };
  }

  it("does not invite a blind retry when the server cannot reconcile persistence", async () => {
    const f = callerFixture(async () => Response.json({
      error: "Upload outcome could not be confirmed. Check the gallery before retrying.",
      code: "UPLOAD_STATE_UNKNOWN",
      retryable: false,
    }, { status: 503 }));
    await f.upload([imageFile(pngBytes, { name: "trip.png", type: "image/png" })]);
    expect(f.setUploadStatus).toHaveBeenLastCalledWith(
      "0 of 1 photos uploaded. Check the gallery before retrying: trip.png.",
    );
  });

  it.each([
    ["browser response loss", async () => { throw new Error("connection closed"); }],
    ["unreadable server response", async () => new Response("not json", { status: 200 })],
  ])("treats %s as unknown rather than retryable", async (_label, fetchImpl) => {
    const f = callerFixture(fetchImpl as typeof fetch);
    await f.upload([imageFile(pngBytes, { name: "trip.png", type: "image/png" })]);
    expect(f.setUploadStatus).toHaveBeenLastCalledWith(
      "0 of 1 photos uploaded. Check the gallery before retrying: trip.png.",
    );
  });
});
