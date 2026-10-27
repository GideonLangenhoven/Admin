import type { ReactNode } from "react";
import "./catalogue.css";

// The original storefront card, shared with the settings preview. Keep the
// components/booking copy identical across the two separate app builds.
export function CatalogueCard({ name, duration, price, dealPrice, description, image, reviews, urgency, actionLabel, onSelect }: {
  name: string;
  duration: string;
  price: number | null | undefined;
  // Lowest last-minute price, shown as "from" beside the struck-through price.
  dealPrice?: number;
  description?: string | null;
  image?: ReactNode;
  reviews?: string;
  urgency?: string | null;
  actionLabel: string;
  onSelect?: () => void;
}) {
  return (
    <button type="button" data-shot="tour-card"
      className="glass glass-hover group cursor-pointer overflow-hidden text-left active:scale-[0.98] flex flex-col"
      style={{ borderRadius: 28 }} onClick={onSelect}>
      <div className="relative aspect-[4/3] overflow-hidden w-full">
        {image && <>{image}<div className="glass-photo-scrim" /></>}
        {typeof price === "number" && Number.isFinite(price) && (
          <span className="glass-chip absolute bottom-3 left-3 px-3.5 py-1.5 font-display text-[15px] font-bold">
            {typeof dealPrice === "number" && dealPrice < price
              ? <><span className="mr-1.5 text-[12px] font-normal line-through" style={{ color: "var(--ink-faint)" }}>R{price}</span><span className="mr-1 text-[11px] font-normal">from</span>R{dealPrice}</>
              : <>R{price}</>}
            <span className="ml-1 text-[11px] font-normal" style={{ color: "var(--ink-muted)" }}>pp</span>
          </span>
        )}
        <span className="glass-chip absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
        </span>
        {urgency && <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide shadow-sm" style={{ background: "var(--danger)", color: "#fff" }}>{urgency}</span>}
      </div>
      <div className="px-5 pb-5 pt-4 w-full">
        <h3 className="font-display text-xl font-semibold leading-tight" style={{ color: "var(--ink)", fontSize: "1.25rem" }}>{name}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="glass-chip inline-flex items-center px-2.5 py-1 text-[11px] font-semibold">{duration}</span>
          {reviews && <span className="glass-chip inline-flex items-center px-2.5 py-1 text-[11px] font-semibold">{reviews}</span>}
        </div>
        {description && <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>{description}</p>}
        <span className="btn btn-primary mt-4 w-full text-[13px]">{actionLabel}</span>
      </div>
    </button>
  );
}

export function CatalogueIntro({ title, eyebrow, subtitle }: {
  title?: string | null;
  eyebrow?: string | null;
  subtitle?: string | null;
}) {
  if (!title?.trim()) return null;
  return (
    <div className="glass mx-auto mb-8 max-w-3xl px-6 py-6 sm:mb-10 sm:px-10 sm:py-8" style={{ borderRadius: 32 }}>
      <div className="page-header text-center mx-auto">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="headline-display">{title}</h2>
        {subtitle && <p className="subhead">{subtitle}</p>}
      </div>
    </div>
  );
}
