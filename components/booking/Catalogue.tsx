import type { ReactNode } from "react";
import Link from "next/link";
import "./catalogue.css";

// Compact horizontal list card. The whole card is the tap target (one link,
// no in-card button). Keep the components/booking copy identical across the
// two separate app builds.
export function CatalogueCard({ name, duration, price, description, image, reviews, urgency, href, target }: {
  name: string;
  duration: string;
  price: number | null | undefined;
  description?: string | null;
  image?: ReactNode;
  reviews?: string;
  urgency?: string | null;
  href: string;
  target?: string;
}) {
  const hasPrice = typeof price === "number" && Number.isFinite(price);
  return (
    <Link href={href} target={target} rel={target === "_blank" ? "noopener noreferrer" : undefined} prefetch={false}
      data-shot="tour-card"
      className="glass glass-hover group flex w-full items-stretch overflow-hidden text-left active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
      style={{ borderRadius: 16 }}>
      <div className="relative w-[40%] shrink-0 overflow-hidden">
        {image && <>{image}<div className="glass-photo-scrim" /></>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3.5 py-3 sm:px-4">
        {urgency && <span className="mb-0.5 self-start rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: "var(--danger)", color: "#fff" }}>{urgency}</span>}
        <h3 className="font-display line-clamp-2 text-[15px] font-semibold leading-snug sm:text-[16px]" style={{ color: "var(--ink)" }}>{name}</h3>
        <p className="text-[12px] leading-snug" style={{ color: "var(--ink-muted)" }}>
          {duration}
          {hasPrice && (
            <> &middot; <span className="font-display text-[14px] font-bold" style={{ color: "var(--ink)" }}>R{price}</span> pp</>
          )}
        </p>
        {reviews && <p className="text-[12px] leading-snug" style={{ color: "var(--ink-muted)" }}>{reviews}</p>}
        {description && <p className="truncate text-[12px] leading-snug" style={{ color: "var(--ink-muted)" }}>{description}</p>}
      </div>
    </Link>
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
