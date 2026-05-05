/* ── Block type definitions (13 types) ── */

export type TextBlock = { type: "text"; id: string; content: string; fontFamily?: string; fontSize?: number; fontWeight?: string; color?: string; textAlign?: string };
export type ImageBlock = { type: "image"; id: string; src: string; alt: string; width: string };
export type DividerBlock = { type: "divider"; id: string };
export type ButtonBlock = { type: "button"; id: string; text: string; url: string; color: string };
export type SpacerBlock = { type: "spacer"; id: string; height: number };
export type HeaderBlock = { type: "header"; id: string; text: string; level: "h1" | "h2" | "h3"; color: string };
export type SocialBlock = { type: "social"; id: string; platforms: Record<string, string> };
export type VideoBlock = { type: "video"; id: string; url: string; thumbnailUrl: string };
export type QuoteBlock = { type: "quote"; id: string; text: string; attribution: string; photoUrl: string };
export type ColumnsBlock = { type: "columns"; id: string; columnCount: 2 | 3; columns: Block[][] };
export type CountdownBlock = { type: "countdown"; id: string; targetDate: string; label: string };
export type TourCardBlock = { type: "tourcard"; id: string; imageUrl: string; title: string; price: string; ctaText: string; ctaUrl: string };
export type FooterBlock = { type: "footer"; id: string; companyName: string; address: string; phone: string; socials: Record<string, string> };

export type Block =
  | TextBlock
  | ImageBlock
  | DividerBlock
  | ButtonBlock
  | SpacerBlock
  | HeaderBlock
  | SocialBlock
  | VideoBlock
  | QuoteBlock
  | ColumnsBlock
  | CountdownBlock
  | TourCardBlock
  | FooterBlock;

export function uid(): string {
  return crypto.randomUUID();
}

export function createBlock(type: Block["type"]): Block {
  const id = uid();
  switch (type) {
    case "text":
      return { type: "text", id, content: "<p></p>" };
    case "image":
      return { type: "image", id, src: "", alt: "Image", width: "100%" };
    case "divider":
      return { type: "divider", id };
    case "button":
      return { type: "button", id, text: "Click Here", url: "https://", color: "#0f5dd7" };
    case "spacer":
      return { type: "spacer", id, height: 24 };
    case "header":
      return { type: "header", id, text: "Heading", level: "h1", color: "#111827" };
    case "social":
      return { type: "social", id, platforms: { facebook: "", instagram: "" } };
    case "video":
      return { type: "video", id, url: "", thumbnailUrl: "" };
    case "quote":
      return { type: "quote", id, text: "Enter a quote here...", attribution: "", photoUrl: "" };
    case "columns":
      return { type: "columns", id, columnCount: 2, columns: [[], []] };
    case "countdown":
      return { type: "countdown", id, targetDate: "", label: "Offer ends in" };
    case "tourcard":
      return { type: "tourcard", id, imageUrl: "", title: "Tour Name", price: "R 350", ctaText: "Book Now", ctaUrl: "https://" };
    case "footer":
      return { type: "footer", id, companyName: "", address: "", phone: "", socials: {} };
  }
}
