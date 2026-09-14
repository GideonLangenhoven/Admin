#!/usr/bin/env node
/**
 * Re-measures each beat's focal width/height without re-recording video.
 * Runs the same beat.run() interactions as the real capture (so focal
 * measurement happens at the exact same point in each beat's flow) but with
 * no recordVideo context, and merges width/height into the existing
 * shots.json in place. The mp4 files are untouched.
 *
 * Usage: node scripts/demo-capture/measure-widths.mjs
 */
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { BEATS, resolveScarceSlot } from "./beats.mjs";

const TARGET_URL = "https://jerrys.booking.bookingtours.co.za/";
const SIZE = { width: 1920, height: 1080 };
const SHOTS_PATH = resolve(homedir(), "Desktop/bookingtours-promo/public/shots/shots.json");

async function main() {
  const browser = await chromium.launch();
  const manifest = JSON.parse(await readFile(SHOTS_PATH, "utf8"));

  const resolvedSlot = await resolveScarceSlot(browser, TARGET_URL);
  if (!resolvedSlot) {
    console.log("✘ No slot resolved — cannot measure widths for beats 03–06b.");
    await browser.close();
    process.exit(1);
  }
  console.log(`Using slot ${resolvedSlot.slotId} (${resolvedSlot.badgeText})`);

  for (const beat of BEATS) {
    const shot = manifest.shots.find((s) => s.id === beat.id);
    if (!shot) continue;
    const context = await browser.newContext({ viewport: SIZE });
    const page = await context.newPage();
    const ctx = { targetUrl: TARGET_URL, resolvedSlot };
    try {
      const focal = await beat.run(page, ctx);
      shot.focal.width = focal.width;
      shot.focal.height = focal.height;
      console.log(`  ✔ ${beat.id}: width=${focal.width} height=${focal.height}`);
    } catch (e) {
      console.log(`  ✘ ${beat.id}: ${e.message}`);
    } finally {
      await context.close();
    }
  }

  await writeFile(SHOTS_PATH, JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log(`\n✔ Updated ${SHOTS_PATH}`);
}

main().catch((e) => {
  console.error("✘ Measure run failed:", e);
  process.exit(1);
});
