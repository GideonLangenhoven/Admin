// Keep the standalone booking/lib/gift-voucher-face.ts copy in sync (separate deployment).
export interface GiftVoucherFace {
  imageUrl?: string | null;
  logoUrl?: string | null;
  businessName?: string | null;
  experienceName?: string | null;
  recipientName?: string | null;
  buyerName?: string | null;
  message?: string | null;
  value: string | number;
  code?: string | null;
  expiresLabel?: string | null;
  monetary?: boolean;
}

function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

export function giftImageUrl(value?: string | null): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    // The URL is embedded in both an HTML attribute and a CSS string.
    return url.href.replace(/["'()<>\\]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch { return ""; }
}

/** Live text on the photograph: readable, selectable and printable, including without images. */
export function renderGiftVoucherFace(gift: GiftVoucherFace): string {
  const image = escape(giftImageUrl(gift.imageUrl));
  const logo = escape(giftImageUrl(gift.logoUrl));
  const text = "margin:0;color:#ffffff;overflow-wrap:anywhere;word-break:break-word;";
  const label = `${text}font-size:12px;line-height:1.5;letter-spacing:1.5px;text-transform:uppercase;`;
  return `<table role="presentation" data-gift-voucher-face width="100%" cellpadding="0" cellspacing="0" style="print-color-adjust:exact;-webkit-print-color-adjust:exact;width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;text-align:left;">
    <tr><td ${image ? `background="${image}"` : ""} bgcolor="#12322e" style="background-color:#12322e;${image ? `background-image:url('${image}');background-size:cover;background-position:center;` : ""}border-radius:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;background-color:#12322e;background-color:rgba(9,30,27,0.68);border-radius:16px;">
        <tr><td style="padding:24px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            ${logo ? `<td style="padding-right:12px;vertical-align:middle;"><img src="${logo}" alt="" width="64" height="44" style="display:block;object-fit:contain;background:#ffffff;border:0;" /></td>` : ""}
            <td style="vertical-align:middle;"><p style="${label}">${escape(gift.businessName || "A gift for you")}</p></td>
          </tr></table>
          <p style="${text}font-size:14px;line-height:1.5;margin-top:28px;">Gift voucher</p>
          ${gift.experienceName ? `<p style="${text}font-size:24px;line-height:1.25;font-weight:700;margin-top:6px;">${escape(gift.experienceName)}</p>` : ""}
          <p style="${text}font-size:40px;line-height:1.2;font-weight:700;margin-top:12px;">R${escape(gift.value)}</p>
          ${gift.monetary ? `<p style="${text}font-size:13px;line-height:1.5;margin-top:4px;">Gift credit · Redeem on any experience</p>` : ""}
          <p style="${text}font-size:16px;line-height:1.5;margin-top:24px;">For <strong>${escape(gift.recipientName || "someone special")}</strong></p>
          ${gift.message ? `<p style="${text}font-size:17px;line-height:1.6;white-space:pre-wrap;margin-top:12px;">${escape(gift.message)}</p>` : ""}
          ${gift.buyerName ? `<p style="${text}font-size:14px;line-height:1.5;margin-top:12px;">From ${escape(gift.buyerName)}</p>` : ""}
          <div style="margin-top:24px;padding-top:18px;border-top:1px solid #8a9d96;">
            <p style="${label}">${gift.code ? "Voucher code" : "Preview · Code issued after payment"}</p>
            ${gift.code ? `<p style="${text}font-family:'Courier New',monospace;font-size:24px;font-weight:700;letter-spacing:2px;line-height:1.4;margin-top:6px;">${escape(gift.code)}</p>` : ""}
            ${gift.expiresLabel ? `<p style="${text}font-size:13px;line-height:1.5;margin-top:10px;">${escape(gift.expiresLabel)}</p>` : ""}
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td align="right" style="text-align:right;color:#ffffff;font-size:5px;line-height:10px;">Powered by BookingTours <img src="https://booking.bookingtours.co.za/brand/bt-mark-ivory.png" alt="BookingTours" width="7" height="9" style="display:inline-block;vertical-align:middle;margin-left:2.5px;border:0;" /></td></tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}
