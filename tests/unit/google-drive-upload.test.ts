import { describe, expect, it, vi } from "vitest";
import { uploadDriveMedia } from "../../app/lib/google-drive-upload";

describe("Google Drive media upload", () => {
  it("starts a resumable upload and sends video bytes to Google's session URL", async () => {
    const session = "https://www.googleapis.com/upload/drive/v3/files?upload_id=abc";
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: session } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "video-id" }), { status: 200 }));
    const file = new File(["video bytes"], "trip.mp4", { type: "video/mp4" });

    await expect(uploadDriveMedia(file, "token", "folder-id", request)).resolves.toBe("video-id");
    expect(request.mock.calls[0][1].body).toContain('"parents":["folder-id"]');
    expect(request.mock.calls[1][0]).toBe(session);
    expect(request.mock.calls[1][1].body).toBe(file);
  });

  it("rejects an upload session outside Google", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { Location: "https://evil.example/upload" } }));
    const file = new File(["image"], "trip.jpg", { type: "image/jpeg" });
    await expect(uploadDriveMedia(file, "token", "folder-id", request)).rejects.toThrow("invalid upload session");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
