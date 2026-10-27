import { existsSync, mkdirSync, writeFileSync } from "node:fs";

// Public asset copies only. The visual test backend never reads live records.
export default async function preparePhotos() {
  const directory = "/private/tmp/capekayak-kayak-demo-photos";
  const base = "https://ukdsrndqhsatjkmxijuj.supabase.co/storage/v1/object/public/email-images/44ff11ab-c697-47de-9227-0ffa51db127c/";
  const photos = {
    "1790663949767.jpeg": "tours/1790663949767.jpeg",
    "1790664015501.jpg": "tours/1790664015501.jpg",
    "1790664062648.jpeg": "tours/1790664062648.jpeg",
    "logo.jpg": "branding/1790664402456.jpg",
  };
  mkdirSync(directory, { recursive: true });
  await Promise.all(Object.entries(photos).map(async ([name, path]) => {
    if (existsSync(directory + "/" + name)) return;
    const response = await fetch(base + path, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("Public catalogue photo unavailable: " + response.status);
    writeFileSync(directory + "/" + name, Buffer.from(await response.arrayBuffer()));
  }));
}
