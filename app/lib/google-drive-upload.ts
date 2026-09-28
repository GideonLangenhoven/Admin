export async function uploadDriveMedia(file: File, accessToken: string, folderId: string, request: typeof fetch = fetch): Promise<string> {
  if (!/^(image|video)\//.test(file.type)) throw new Error("Select a photo or video");

  const start = await request("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": file.type,
      "X-Upload-Content-Length": String(file.size),
    },
    body: JSON.stringify({ name: file.name, parents: [folderId] }),
  });
  if (!start.ok) throw new Error("Google Drive could not start the upload (" + start.status + ")");

  const sessionUrl = start.headers.get("Location") || "";
  if (!sessionUrl || new URL(sessionUrl).origin !== "https://www.googleapis.com") throw new Error("Google Drive returned an invalid upload session");

  // ponytail: one PUT per file; add range-based resume if real video uploads
  // regularly fail on interrupted connections.
  const uploaded = await request(sessionUrl, {
    method: "PUT",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": file.type },
    body: file,
  });
  if (!uploaded.ok) throw new Error("Google Drive rejected the upload (" + uploaded.status + ")");
  const result = await uploaded.json();
  if (!result.id) throw new Error("Google Drive did not return a file ID");
  return result.id;
}
