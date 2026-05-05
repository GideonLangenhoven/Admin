import type { Block } from "./block-types";
import { SOCIAL_PLATFORMS } from "./social-icons";

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
      const ff = b.fontFamily ? `font-family:${b.fontFamily};` : "";
      const fs = b.fontSize ? `font-size:${b.fontSize}px;` : "font-size:15px;";
      const fw = b.fontWeight ? `font-weight:${b.fontWeight};` : "";
      const fc = b.color ? `color:${b.color};` : "color:#374151;";
      const ta = b.textAlign ? `text-align:${b.textAlign};` : "";
      return `<div style="padding:8px 0;line-height:1.6;${ff}${fs}${fw}${fc}${ta}">${b.content}</div>`;
    }

    case "image":
      return `<div style="padding:8px 0;text-align:center;"><img src="${escapeAttr(b.src)}" alt="${escapeAttr(b.alt)}" style="max-width:${escapeAttr(b.width || "100%")};height:auto;border-radius:8px;" /></div>`;

    case "divider":
      return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />`;

    case "button":
      return `<div style="padding:12px 0;text-align:center;"><a href="${escapeAttr(b.url)}" style="display:inline-block;padding:12px 28px;background:${escapeAttr(b.color || "#0f5dd7")};color:#fff;font-weight:600;font-size:14px;border-radius:8px;text-decoration:none;">${escapeAttr(b.text)}</a></div>`;

    case "spacer":
      return `<div style="height:${b.height}px;line-height:${b.height}px;font-size:1px;">&nbsp;</div>`;

    case "header": {
      const sizes: Record<string, string> = { h1: "28px", h2: "22px", h3: "18px" };
      const weights: Record<string, string> = { h1: "700", h2: "600", h3: "600" };
      return `<${b.level} style="margin:0;padding:8px 0;font-size:${sizes[b.level]};font-weight:${weights[b.level]};color:${escapeAttr(b.color || "#111827")};">${escapeAttr(b.text)}</${b.level}>`;
    }

    case "social": {
      const links = Object.entries(b.platforms)
        .filter(([, url]) => url.trim())
        .map(([key, url]) => {
          const platform = SOCIAL_PLATFORMS[key];
          if (!platform) return "";
          return `<a href="${escapeAttr(url)}" target="_blank" style="display:inline-block;margin:0 5px;text-decoration:none;"><img src="${escapeAttr(platform.icon)}" alt="${escapeAttr(platform.label)}" width="36" height="36" style="display:block;border-radius:8px;" /></a>`;
        })
        .filter(Boolean)
        .join("");
      return `<div style="padding:16px 0;text-align:center;">${links}</div>`;
    }

    case "video": {
      const thumb = b.thumbnailUrl || autoThumbnail(b.url);
      return `<div style="padding:8px 0;text-align:center;">
<a href="${escapeAttr(b.url)}" style="display:inline-block;position:relative;text-decoration:none;">
<img src="${escapeAttr(thumb)}" alt="Video" style="max-width:100%;height:auto;border-radius:8px;display:block;" />
<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:60px;height:60px;background:rgba(0,0,0,0.6);border-radius:50%;display:flex;align-items:center;justify-content:center;">
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
        ? `<div style="margin-top:8px;font-size:13px;color:#6b7280;">${photoHtml}${escapeAttr(b.attribution)}</div>`
        : "";
      return `<div style="padding:12px 0;">
<div style="border-left:4px solid #0f5dd7;padding:12px 16px;margin:0;">
<div style="font-style:italic;font-size:15px;line-height:1.6;color:#374151;">${escapeAttr(b.text)}</div>
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
        return `<div style="padding:16px 0;text-align:center;font-size:15px;color:#6b7280;">${escapeAttr(b.label || "Countdown")}: set a target date</div>`;
      }
      const target = new Date(b.targetDate);
      const now = new Date();
      const diffMs = target.getTime() - now.getTime();
      const days = Math.max(0, Math.floor(diffMs / 86400000));
      const hours = Math.max(0, Math.floor((diffMs % 86400000) / 3600000));
      return `<div style="padding:16px 0;text-align:center;">
<div style="font-size:13px;color:#6b7280;margin-bottom:6px;">${escapeAttr(b.label)}</div>
<div style="font-size:28px;font-weight:700;color:#111827;">${days}d ${hours}h</div>
</div>`;
    }

    case "tourcard": {
      const imgHtml = b.imageUrl
        ? `<img src="${escapeAttr(b.imageUrl)}" alt="${escapeAttr(b.title)}" style="width:100%;height:auto;border-radius:8px 8px 0 0;display:block;" />`
        : `<div style="height:160px;background:#e5e7eb;border-radius:8px 8px 0 0;"></div>`;
      return `<div style="padding:8px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td>${imgHtml}</td></tr>
<tr><td style="padding:16px;">
<div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:4px;">${escapeAttr(b.title)}</div>
<div style="font-size:15px;color:#6b7280;margin-bottom:12px;">${escapeAttr(b.price)}</div>
<a href="${escapeAttr(b.ctaUrl)}" style="display:inline-block;padding:10px 24px;background:#0f5dd7;color:#fff;font-weight:600;font-size:14px;border-radius:8px;text-decoration:none;">${escapeAttr(b.ctaText)}</a>
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
          return `<a href="${escapeAttr(url)}" target="_blank" style="display:inline-block;margin:0 4px;"><img src="${escapeAttr(platform.icon)}" alt="${escapeAttr(platform.label)}" width="28" height="28" style="display:block;border-radius:6px;" /></a>`;
        })
        .filter(Boolean)
        .join("");
      return `<div style="padding:16px 0;text-align:center;border-top:1px solid #e5e7eb;margin-top:8px;">
<div style="font-size:14px;font-weight:600;color:#374151;">${escapeAttr(b.companyName)}</div>
${b.address ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;">${escapeAttr(b.address)}</div>` : ""}
${b.phone ? `<div style="font-size:12px;color:#9ca3af;margin-top:2px;">${escapeAttr(b.phone)}</div>` : ""}
${socialRow ? `<div style="margin-top:8px;">${socialRow}</div>` : ""}
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
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px;">
<div style="background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
${inner}
</div>
<div style="text-align:center;padding:16px 0;font-size:11px;color:#9ca3af;">
<p>You received this email because you subscribed. <a href="{{unsubscribe_url}}" style="color:#6b7280;">Unsubscribe</a></p>
</div>
</div>
</body></html>`;
}
