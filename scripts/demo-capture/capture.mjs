#!/usr/bin/env node
/**
 * BookingTours demo capture — Playwright.
 *
 * Produces honest video clips of the real booking flow at
 * https://jerrys.booking.bookingtours.co.za/, plus a manifest a Remotion
 * compositor consumes downstream. Nothing here stubs, mocks, or re-times
 * anything the app renders — see docs/demo-design-system for the source
 * spec this implements.
 *
 * Usage:
 *   node scripts/demo-capture/capture.mjs --check       # stage readiness only, captures nothing
 *   node scripts/demo-capture/capture.mjs                # capture beats 01–06b, hold in screencast mode (A)
 *   node scripts/demo-capture/capture.mjs --hold-mode=B  # beat 05 via clock-stepped PNG sequence instead
 *   node scripts/demo-capture/capture.mjs --only=02,05   # capture a subset (comma-separated beat ids)
 *
 * Output: ~/Desktop/bookingtours-promo/public/shots/{01..06b}.mp4 + shots.json
 */
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { CURSOR_INIT_SCRIPT } from "./cursor.mjs";
import { BEATS, resolveScarceSlot } from "./beats.mjs";
import { checkStage } from "./check-stage.mjs";

const execFileAsync = promisify(execFile);

const TARGET_URL = "https://jerrys.booking.bookingtours.co.za/";
const FPS = 25;
const SIZE = { width: 1920, height: 1080 };
const OUT_DIR = resolve(homedir(), "Desktop/bookingtours-promo/public/shots");
const TMP_DIR = resolve(process.cwd(), ".demo-capture-tmp");

function parseArgs(argv) {
  const args = { checkOnly: false, holdMode: "A", only: null };
  for (const a of argv) {
    if (a === "--check") args.checkOnly = true;
    else if (a.startsWith("--hold-mode=")) args.holdMode = a.split("=")[1].toUpperCase();
    else if (a.startsWith("--only=")) args.only = a.split("=")[1].split(",").map((s) => s.trim());
  }
  return args;
}

async function ensureDirs() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });
}

async function transcode(webmPath, mp4Path) {
  // h264 seeks faster and renders more reliably in Remotion's
  // <OffthreadVideo> than webm, even though it reads webm natively.
  await execFileAsync("ffmpeg", [
    "-y", "-i", webmPath,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow",
    mp4Path,
  ]);
}

async function framesToMp4(framesDir, mp4Path, fps) {
  await execFileAsync("ffmpeg", [
    "-y", "-framerate", String(fps),
    "-i", join(framesDir, "%05d.png"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow",
    mp4Path,
  ]);
}

async function runScreencastBeat(browser, beat, ctx) {
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: TMP_DIR, size: SIZE },
  });
  await context.addInitScript(CURSOR_INIT_SCRIPT);
  const page = await context.newPage();
  await page.addStyleTag({ content: "::-webkit-scrollbar { display: none }" });

  let focal = null;
  let attempts = 0;
  const maxAttempts = 3;
  let lastErr = null;
  // Retry the interaction (not the recording philosophy) up to 3x per the
  // spec's own bar — a flaky capture past that is a UX bug worth reporting,
  // not papering over with a 4th retry.
  while (attempts < maxAttempts) {
    attempts++;
    try {
      focal = await beat.run(page, ctx);
      break;
    } catch (e) {
      lastErr = e;
      console.warn(`  ⚠ beat ${beat.id} attempt ${attempts}/${maxAttempts} failed: ${e.message}`);
      if (attempts < maxAttempts) {
        await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
      }
    }
  }
  if (!focal) {
    await context.close();
    throw new Error(`beat ${beat.id} failed after ${maxAttempts} attempts: ${lastErr?.message}`);
  }

  const video = page.video();
  await context.close();
  const webmPath = join(TMP_DIR, `${beat.id}.webm`);
  await video.saveAs(webmPath);

  return { focal, webmPath, attempts };
}

async function runClockSteppedBeat(browser, beat, ctx, durationMs) {
  const context = await browser.newContext({ viewport: SIZE });
  await context.addInitScript(CURSOR_INIT_SCRIPT);
  const page = await context.newPage();
  await page.addStyleTag({ content: "::-webkit-scrollbar { display: none }" });

  const framesDir = join(TMP_DIR, `${beat.id}-frames`);
  await mkdir(framesDir, { recursive: true });

  const { focal, clockNow } = await beat.setup(page, ctx);
  await page.clock.pauseAt(clockNow ?? new Date());

  const frameMs = Math.round(1000 / FPS);
  const totalFrames = Math.round(durationMs / frameMs);
  for (let f = 0; f < totalFrames; f++) {
    await page.clock.runFor(frameMs);
    await page.screenshot({ path: join(framesDir, `${String(f).padStart(5, "0")}.png`) });
  }

  await context.close();
  return { focal, framesDir, frameCount: totalFrames };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureDirs();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: SIZE });
  console.log(`Checking stage readiness against ${TARGET_URL} ...`);
  const readiness = await checkStage(page, TARGET_URL);
  await page.close();

  console.log("\n── Stage readiness ──");
  for (const r of readiness.checks) {
    console.log(`  ${r.pass ? "✔" : "✘"} ${r.label}${r.detail ? " — " + r.detail : ""}`);
  }
  if (!readiness.ok) {
    console.log("\nStage is not ready. Per spec: STOP — fix seed data, do not fix it in the browser.");
    if (args.checkOnly || !args.only) {
      await browser.close();
      process.exit(readiness.ok ? 0 : 1);
    }
    console.log("Continuing anyway because --only was passed explicitly for a subset of beats.\n");
  } else {
    console.log("\nStage ready.");
    if (args.checkOnly) { await browser.close(); return; }
  }

  const beatsToRun = args.only ? BEATS.filter((b) => args.only.includes(b.id)) : BEATS;
  const manifestShots = [];
  const retryReport = [];

  // Resolved ONCE, outside any recording context, so beats 03–06b can deep-
  // link straight to the scarce slot instead of re-walking the calendar
  // inside their own footage. Only needed if one of those beats is running.
  let resolvedSlot = null;
  if (beatsToRun.some((b) => ["03-addons", "04-promo", "05-hold", "06-checkout", "06b-gateway"].includes(b.id))) {
    console.log("\nResolving the scarce slot once for beats 03–06b...");
    resolvedSlot = await resolveScarceSlot(browser, TARGET_URL);
    if (!resolvedSlot) {
      console.log("✘ No scarce slot found — cannot run beats 03–06b. Fix seed data first.");
      await browser.close();
      process.exit(1);
    }
    console.log(`  Using slot ${resolvedSlot.slotId} (${resolvedSlot.badgeText})`);
  }

  for (const beat of beatsToRun) {
    console.log(`\n▶ ${beat.id} — ${beat.description}`);
    const ctx = { targetUrl: TARGET_URL, readiness, resolvedSlot };

    if (beat.mode === "B") {
      if (args.holdMode !== "B") {
        console.log(`  Mode B available for ${beat.id} but not selected (pass --hold-mode=B to use it). Using screencast (A).`);
      } else {
        const durationMs = beat.durationMs;
        const { focal, framesDir, frameCount } = await runClockSteppedBeat(browser, beat, ctx, durationMs);
        const mp4Path = join(OUT_DIR, `${beat.id}.mp4`);
        await framesToMp4(framesDir, mp4Path, FPS);
        await rm(framesDir, { recursive: true, force: true });
        manifestShots.push({
          id: beat.id, file: `${beat.id}.mp4`, durationMs,
          focal, hero: !!beat.hero, caption: beat.caption,
        });
        console.log(`  ✔ ${frameCount} frames → ${mp4Path}`);
        continue;
      }
    }

    const { focal, webmPath, attempts } = await runScreencastBeat(browser, beat, ctx);
    if (attempts > 1) retryReport.push({ id: beat.id, attempts });
    const mp4Path = join(OUT_DIR, `${beat.id}.mp4`);
    await transcode(webmPath, mp4Path);
    await rm(webmPath, { force: true });
    manifestShots.push({
      id: beat.id, file: `${beat.id}.mp4`, durationMs: beat.durationMs,
      focal, hero: !!beat.hero, caption: beat.caption,
    });
    console.log(`  ✔ → ${mp4Path}`);
  }

  const manifest = {
    capturedAt: new Date().toISOString(),
    tenant: "jerrys",
    fps: FPS,
    size: SIZE,
    shots: manifestShots,
  };
  const manifestPath = join(OUT_DIR, "shots.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n✔ Manifest → ${manifestPath}`);

  if (retryReport.length > 0) {
    console.log("\n⚠ Beats that needed a retry (a flaky capture is usually a flaky interaction — a UX problem worth reporting, not a script problem to paper over):");
    for (const r of retryReport) console.log(`  - ${r.id}: ${r.attempts} attempts`);
  }

  await rm(TMP_DIR, { recursive: true, force: true });
  await browser.close();

  const files = await readdir(OUT_DIR);
  console.log(`\nDone. ${files.filter((f) => f.endsWith(".mp4")).length} clip(s) + manifest in ${OUT_DIR}`);
}

main().catch((e) => {
  console.error("\n✘ Capture run failed:", e);
  process.exit(1);
});
