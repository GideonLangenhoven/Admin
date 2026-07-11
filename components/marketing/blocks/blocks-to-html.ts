import type { Block } from "./block-types";
import { SOCIAL_PLATFORMS } from "./social-icons";

/* ── Brand system (matches docs/EMAIL_DESIGN_SPEC.md + docs/BRAND.md) ──
   Warm paper canvas, deep pine, one amber highlight, serif display over
   sans body, Courier micro-labels. Blocks keep their editable API; only
   the rendered look changed. */
const PINE = "#1b3b36";
const CANVAS = "#F7F5F0";
const INK = "#17221C";
const BODY = "#4A5651";
const MUTED = "#66736B";
const BORDER = "#E7E3DA";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'Courier New',monospace";

/* ── Utility ── */

export function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── Single block → HTML ── */

function blockToHtml(b: Block): string {
  switch (b.type) {
    case "text": {
      const ff = b.fontFamily ? `font-family:${b.fontFamily};` : `font-family:${SANS};`;
      const fs = b.fontSize ? `font-size:${b.fontSize}px;` : "font-size:16px;";
      const fw = b.fontWeight ? `font-weight:${b.fontWeight};` : "";
      const fc = b.color ? `color:${b.color};` : `color:${BODY};`;
      const ta = b.textAlign ? `text-align:${b.textAlign};` : "";
      return `<div style="padding:8px 0;line-height:1.65;${ff}${fs}${fw}${fc}${ta}">${b.content}</div>`;
    }

    case "image":
      return `<div style="padding:10px 0;text-align:center;"><img src="${escapeAttr(b.src)}" alt="${escapeAttr(b.alt)}" style="max-width:${escapeAttr(b.width || "100%")};height:auto;border-radius:12px;display:inline-block;" /></div>`;

    case "divider":
      return `<hr style="border:none;border-top:1px solid ${BORDER};margin:20px 0;" />`;

    case "button":
      return `<div style="padding:14px 0;text-align:center;"><a href="${escapeAttr(b.url)}" style="display:inline-block;padding:14px 34px;background:${escapeAttr(b.color || PINE)};color:#ffffff;font-family:${SANS};font-weight:600;font-size:15px;letter-spacing:.01em;border-radius:12px;text-decoration:none;">${escapeAttr(b.text)}</a></div>`;

    case "spacer":
      return `<div style="height:${b.height}px;line-height:${b.height}px;font-size:1px;">&nbsp;</div>`;

    case "header": {
      const sizes: Record<string, string> = { h1: "30px", h2: "23px", h3: "18px" };
      const heights: Record<string, string> = { h1: "1.2", h2: "1.25", h3: "1.3" };
      return `<${b.level} style="margin:0;padding:10px 0 6px;font-family:${SERIF};font-size:${sizes[b.level]};line-height:${heights[b.level]};font-weight:500;letter-spacing:-0.01em;color:${escapeAttr(b.color || INK)};">${escapeAttr(b.text)}</${b.level}>`;
    }

    case "social": {
      const links = Object.entries(b.platforms)
        .filter(([, url]) => url.trim())
        .map(([key, url]) => {
          const platform = SOCIAL_PLATFORMS[key];
          if (!platform) return "";
          return `<a href="${escapeAttr(url)}" target="_blank" style="display:inline-block;margin:0 5px;text-decoration:none;"><img src="${escapeAttr(platform.icon)}" alt="${escapeAttr(platform.label)}" width="32" height="32" style="display:block;border-radius:8px;" /></a>`;
        })
        .filter(Boolean)
        .join("");
      return `<div style="padding:16px 0;text-align:center;">${links}</div>`;
    }

    case "video": {
      const thumb = b.thumbnailUrl || autoThumbnail(b.url);
      return `<div style="padding:10px 0;text-align:center;">
<a href="${escapeAttr(b.url)}" style="display:inline-block;position:relative;text-decoration:none;">
<img src="${escapeAttr(thumb)}" alt="Video" style="max-width:100%;height:auto;border-radius:12px;display:block;" />
<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:60px;height:60px;background:rgba(23,34,28,0.72);border-radius:50%;display:flex;align-items:center;justify-content:center;">
<div style="width:0;height:0;border-style:solid;border-width:12px 0 12px 20px;border-color:transparent transparent transparent #ffffff;margin-left:4px;"></div>
</div>
</a>
</div>`;
    }

    case "quote": {
      const photoHtml = b.photoUrl
        ? `<img src="${escapeAttr(b.photoUrl)}" alt="" style="width:40px;height:40px;border-radius:50%;margin-right:10px;vertical-align:middle;" />`
        : "";
      const attrHtml = b.attribution
        ? `<div style="margin-top:10px;font-family:${MONO};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED};">${photoHtml}${escapeAttr(b.attribution)}</div>`
        : "";
      return `<div style="padding:12px 0;">
<div style="background:${CANVAS};border-radius:12px;padding:18px 20px;">
<div style="font-family:${SERIF};font-style:italic;font-size:17px;line-height:1.55;color:${INK};">&ldquo;${escapeAttr(b.text)}&rdquo;</div>
${attrHtml}
</div>
</div>`;
    }

    case "columns": {
      const colWidth = b.columnCount === 2 ? "50%" : "33.3333%";
      const tds = b.columns
        .map(
          (col) =>
            `<td class="col-cell" style="width:${colWidth};vertical-align:top;padding:0 8px;">${col.map(blockToHtml).join("")}</td>`
        )
        .join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:8px 0;"><tr>${tds}</tr></table>`;
    }

    case "countdown": {
      if (!b.targetDate) {
        return `<div style="padding:16px 0;text-align:center;font-family:${SANS};font-size:15px;color:${MUTED};">${escapeAttr(b.label || "Countdown")}: set a target date</div>`;
      }
      const target = new Date(b.targetDate);
      const now = new Date();
      const diffMs = target.getTime() - now.getTime();
      const days = Math.max(0, Math.floor(diffMs / 86400000));
      const hours = Math.max(0, Math.floor((diffMs % 86400000) / 3600000));
      return `<div style="padding:16px 0;text-align:center;">
<div style="font-family:${MONO};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};margin-bottom:6px;">${escapeAttr(b.label)}</div>
<div style="font-family:${SERIF};font-size:32px;font-weight:500;color:#D9822F;">${days}d ${hours}h</div>
</div>`;
    }

    case "tourcard": {
      const imgHtml = b.imageUrl
        ? `<img src="${escapeAttr(b.imageUrl)}" alt="${escapeAttr(b.title)}" style="width:100%;height:auto;border-radius:14px 14px 0 0;display:block;" />`
        : `<div style="height:150px;background:${PINE};border-radius:14px 14px 0 0;"></div>`;
      return `<div style="padding:10px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">
<tr><td>${imgHtml}</td></tr>
<tr><td style="padding:18px 20px;">
<div style="font-family:${SERIF};font-size:19px;font-weight:500;color:${INK};margin-bottom:4px;">${escapeAttr(b.title)}</div>
<div style="font-family:${MONO};font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};margin-bottom:14px;">${escapeAttr(b.price)}</div>
<a href="${escapeAttr(b.ctaUrl)}" style="display:inline-block;padding:11px 26px;background:${PINE};color:#ffffff;font-family:${SANS};font-weight:600;font-size:14px;border-radius:10px;text-decoration:none;">${escapeAttr(b.ctaText)}</a>
</td></tr>
</table>
</div>`;
    }

    case "footer": {
      const socialRow = Object.entries(b.socials || {})
        .filter(([, url]) => url.trim())
        .map(([key, url]) => {
          const platform = SOCIAL_PLATFORMS[key];
          if (!platform) return "";
          return `<a href="${escapeAttr(url)}" target="_blank" style="display:inline-block;margin:0 4px;"><img src="${escapeAttr(platform.icon)}" alt="${escapeAttr(platform.label)}" width="26" height="26" style="display:block;border-radius:6px;" /></a>`;
        })
        .filter(Boolean)
        .join("");
      return `<div style="padding:20px 0 4px;text-align:center;border-top:1px solid ${BORDER};margin-top:12px;">
<div style="font-family:${SERIF};font-size:15px;font-weight:500;color:${INK};">${escapeAttr(b.companyName)}</div>
${b.address ? `<div style="font-family:${MONO};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};margin-top:6px;">${escapeAttr(b.address)}</div>` : ""}
${b.phone ? `<div style="font-family:${MONO};font-size:11px;letter-spacing:.1em;color:${MUTED};margin-top:2px;">${escapeAttr(b.phone)}</div>` : ""}
${socialRow ? `<div style="margin-top:10px;">${socialRow}</div>` : ""}
</div>`;
    }

    default:
      return "";
  }
}

/* ── Auto-generate thumbnail from YouTube/Vimeo ── */

function autoThumbnail(url: string): string {
  if (!url) return "";
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (ytMatch) return `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
  // Vimeo — can't reliably get thumb without API, use placeholder
  return "";
}

/* ── Head styles (responsive columns) ── */

const HEAD_STYLES = `<style>
@media (max-width: 480px) {
  .col-cell { display:block!important; width:100%!important; padding:0 0 8px 0!important; }
}
</style>`;

/* ── Full document compiler ── */

export function blocksToHtml(blocks: Block[]): string {
  const inner = blocks.map(blockToHtml).join("\n");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${HEAD_STYLES}</head>
<body style="margin:0;padding:0;background:${CANVAS};font-family:${SANS};">
<div style="max-width:600px;margin:0 auto;padding:28px 20px;">
<div style="background:#ffffff;border-radius:16px;padding:36px 32px;box-shadow:0 12px 32px -16px rgba(15,43,31,.18);">
${inner}
</div>
<div style="text-align:center;padding:18px 0;font-family:${MONO};font-size:11px;letter-spacing:.08em;color:#9AA39C;">
<p>You received this email because you subscribed. <a href="{{unsubscribe_url}}" style="color:${MUTED};">Unsubscribe</a></p>
</div>
</div>
</body></html>`;
}
