"use client";

import { Inter, Quicksand } from "next/font/google";
import { useState, type CSSProperties } from "react";
import { computeTheme } from "../../app/lib/theme-engine";
import { formatDuration } from "../../app/lib/duration";
import { CatalogueCard, CatalogueIntro } from "./Catalogue";
import { BrandMark, BrandWordmark } from "../BrandLogo";

// The storefront's existing font defaults. Keep the preview's display token
// scoped here so it cannot change the admin application's typography.
const body = Inter({ subsets: ["latin"] });
const display = Quicksand({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });

type PreviewTour = {
  id: string;
  name: string;
  duration_minutes: number | null;
  base_price_per_person: number | null;
  description: string | null;
  image_url: string | null;
  active: boolean;
  hidden: boolean;
};
type PreviewSettings = Partial<Record<
  "color_main" | "color_secondary" | "color_cta" | "color_bg" | "color_nav" | "color_hover" |
  "business_name" | "business_tagline" | "logo_url" | "booking_site_url" |
  "hero_title" | "hero_eyebrow" | "hero_subtitle" | "hero_image" |
  "nav_gift_voucher_label" | "nav_my_bookings_label" | "card_cta_label" |
  "footer_line_one" | "footer_line_two" | "chat_widget_label", string | null
>>;

export default function BookingSitePreview({ siteSettings, tours }: { siteSettings: PreviewSettings; tours: PreviewTour[] }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = computeTheme({
    main: siteSettings.color_main, secondary: siteSettings.color_secondary,
    cta: siteSettings.color_cta, bg: siteSettings.color_bg,
    nav: siteSettings.color_nav, hover: siteSettings.color_hover,
  });
  const name = siteSettings.business_name || "Book Your Tour";
  const base = (siteSettings.booking_site_url || "").replace(/\/+$/, "");
  const actionLabel = siteSettings.card_cta_label || "Book Now";
  const visibleTours = tours.filter(tour => tour.active && !tour.hidden);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-[var(--ck-border-subtle)]">
        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Booking Page Preview</h3>
        {base && <a href={base} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--ck-accent)] underline underline-offset-2">Open booking page</a>}
      </div>
      <p className="text-xs text-[var(--ck-text-muted)] mb-4">Preview of visible tours and saved settings. Text colours adjust for readability.</p>
      <div className={`catalogue-preview ${body.className} ${display.variable}`} style={theme.vars as CSSProperties} data-booking-preview>
        <div className="glass-backdrop" aria-hidden="true">
          <div className="glass-backdrop-mesh" />
          {siteSettings.hero_image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={siteSettings.hero_image} alt="" loading="lazy" style={{ position: "absolute", inset: 0, filter: "blur(2px)", transform: "scale(1.03)" }} />
          )}
        </div>
        <header className="glass-nav">
          <div className="app-container flex items-center justify-between py-3">
            <a className="flex items-center gap-3 rounded-full px-2 py-1 transition-colors hover:bg-[color:var(--hover-overlay)]" href={base || undefined} target="_blank" rel="noopener noreferrer">
              {siteSettings.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={siteSettings.logo_url} alt={name} width={120} height={36} className="h-9 w-auto object-contain" />
              ) : <span className="glass-chip flex h-9 w-9 shrink-0 items-center justify-center font-display text-base font-bold" style={{ color: "var(--accent-text)" }} aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "B"}</span>}
              <div>
                <h1 className="font-display text-base font-semibold leading-tight text-[color:var(--ink-nav)] sm:text-lg">{name}</h1>
                {siteSettings.business_tagline && <p className="glass-eyebrow normal-case tracking-normal">{siteSettings.business_tagline}</p>}
              </div>
            </a>
            <nav className="preview-desktop-nav items-center gap-1 text-sm" aria-label="Booking preview">
              <a className="btn btn-ghost px-3 py-2" href={base ? base + "/voucher" : undefined} target="_blank" rel="noopener noreferrer">{siteSettings.nav_gift_voucher_label || "Gift Voucher"}</a>
              <a className="btn btn-primary px-4 py-2" href={base ? base + "/my-bookings" : undefined} target="_blank" rel="noopener noreferrer">{siteSettings.nav_my_bookings_label || "My Bookings"}</a>
            </nav>
            <button type="button" onClick={() => setMenuOpen(open => !open)} className="preview-menu-button relative h-11 w-11 shrink-0 items-center justify-center rounded-full text-[color:var(--ink-nav)] transition-colors hover:bg-[color:var(--hover-overlay)]" aria-label="Preview menu" aria-expanded={menuOpen}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                {menuOpen ? <><path d="m18 6-12 12" /><path d="m6 6 12 12" /></> : <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>}
              </svg>
            </button>
          </div>
          {menuOpen && <nav className="preview-mobile-nav app-container flex flex-col gap-1 border-t border-[color:var(--glass-border)] py-3" aria-label="Booking preview menu">
            <a className="rounded-full px-4 py-3 text-sm font-medium text-[color:var(--ink-nav)] hover:bg-[color:var(--hover-overlay)]" href={base ? base + "/voucher" : undefined} target="_blank" rel="noopener noreferrer">{siteSettings.nav_gift_voucher_label || "Gift Voucher"}</a>
            <a className="rounded-full px-4 py-3 text-sm font-medium text-[color:var(--ink-nav)] hover:bg-[color:var(--hover-overlay)]" href={base ? base + "/my-bookings" : undefined} target="_blank" rel="noopener noreferrer">{siteSettings.nav_my_bookings_label || "My Bookings"}</a>
          </nav>}
        </header>
        <div className="app-container page-wrap">
          <CatalogueIntro title={siteSettings.hero_title} eyebrow={siteSettings.hero_eyebrow} subtitle={siteSettings.hero_subtitle} />
          <div className="catalogue-preview-grid grid">
            {visibleTours.map(tour => (
              <CatalogueCard key={tour.id} name={tour.name} duration={formatDuration(tour.duration_minutes)}
                price={tour.base_price_per_person} description={tour.description}
                image={tour.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tour.image_url} alt={tour.name + " tour"} loading="lazy" />
                ) : undefined}
                actionLabel={actionLabel}
                onSelect={base ? () => window.open(base + "/book?tour=" + tour.id, "_blank", "noopener,noreferrer") : undefined} />
            ))}
          </div>
          {visibleTours.length === 0 && <p className="py-12 text-center">Your visible tours will appear here.</p>}
        </div>
        <footer className="mt-14 px-4 pb-6">
          <div className="glass-sheet app-container py-8 text-center text-sm text-[color:var(--ink-muted)]">
            <p className="max-w-none">{siteSettings.footer_line_one || (name + (siteSettings.business_tagline ? " · " + siteSettings.business_tagline : ""))}</p>
            {siteSettings.footer_line_two && <p className="mt-1 max-w-none">{siteSettings.footer_line_two}</p>}
            <p className="glass-chip mx-auto mt-4 inline-flex max-w-full items-center gap-2 px-4 py-2 text-xs">
              <span>Secure checkout: payments processed by PCI DSS compliant providers &middot; card details never touch our servers &middot; TLS encrypted</span>
            </p>
            <nav className="mt-4 flex flex-wrap justify-center gap-4">
              {[["/terms", "Terms & Conditions"], ["/privacy", "Privacy Policy"], ["/cookies", "Cookies Policy"], ["/popia", "Privacy Request"]].map(([href, label]) => <a key={href} href={base ? base + href : undefined} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[color:var(--ink)]">{label}</a>)}
            </nav>
            <a href="https://bookingtours.co.za" target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-2 opacity-70 transition-opacity hover:opacity-100" title="Powered by BookingTours">
              <BrandMark size={16} />
              <span className="flex items-baseline gap-1.5 text-[color:var(--textMuted)]">
                <span className="text-[10px] font-medium uppercase tracking-[0.1em]">Powered by</span>
                <BrandWordmark className="text-[13px]" />
              </span>
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
