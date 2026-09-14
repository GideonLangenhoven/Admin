/**
 * Synthetic cursor. Playwright's recordVideo does not draw a cursor — without
 * this, every click in the footage looks like the page clicked itself. This
 * is injected via page.addInitScript so it exists before any app code runs,
 * survives navigations within the same context, and only reflects real
 * mouse.move() calls issued by the script — it never moves on its own.
 */
export const CURSOR_INIT_SCRIPT = `
(() => {
  if (window.__demoCursorInstalled) return;
  window.__demoCursorInstalled = true;
  const el = document.createElement("div");
  el.id = "__demo-cursor";
  el.style.cssText = [
    "position:fixed", "top:0", "left:0", "width:22px", "height:22px",
    "border-radius:50%", "background:rgba(15,43,31,0.85)",
    "border:2px solid rgba(255,255,255,0.9)",
    "box-shadow:0 1px 4px rgba(0,0,0,0.35)",
    "pointer-events:none", "z-index:2147483647",
    "transform:translate(-50%,-50%)", "will-change:transform",
    "transition:transform 30ms linear",
  ].join(";");
  el.style.transform = "translate(-9999px,-9999px)";
  const mount = () => document.body && document.body.appendChild(el);
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  window.addEventListener("mousemove", (e) => {
    el.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px) translate(-50%,-50%)";
  }, { passive: true });
})();
`;

/** Move the cursor off-frame (used before beat 05 — zero cursor, per spec). */
export async function hideCursor(page) {
  await page.evaluate(() => {
    const el = document.getElementById("__demo-cursor");
    if (el) el.style.transform = "translate(-9999px,-9999px)";
  });
  // Also physically park the real pointer off-viewport so no residual
  // hover state (:hover styles) lingers into the beat.
  await page.mouse.move(-50, -50);
}
