import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import AuthGate from "../components/AuthGate";
import AppShell from "../components/AppShell";
import AppNotifications from "../components/AppNotifications";
import ThemeProvider from "../components/ThemeProvider";

/* Brand type system (docs/BRAND.md + docs/ADMIN_REDESIGN_SPEC.md):
   Satoshi — geometric display face for page titles and hero numerals.
   Plus Jakarta Sans — all UI and data. Geist Mono — the instrument voice (labels, timestamps).

   The pairing works on measured metrics, not vibes: Satoshi cap-height 0.740em vs
   Plus Jakarta Sans 0.745em (0.7% apart), so titles, hero numerals and body text sit on
   the same optical line with no size-adjust needed. Satoshi's x-height is 7% smaller,
   which is why it stays on display duty only — Plus Jakarta Sans's taller lowercase is
   what keeps the 11-13px table text legible.

   Satoshi is self-hosted: it is a Fontshare (Indian Type Foundry) face, not on Google
   Fonts, and CSP is `font-src 'self' data:`. next/font serves it same-origin, so no CSP
   change. Licence: app/fonts/Satoshi-LICENSE.txt (free for commercial use). */
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
// ponytail: one variable woff2 (42KB) covers 300-900. Italic axis skipped — no italic titles today.
const satoshi = localFont({
  src: "./fonts/Satoshi-Variable.woff2",
  weight: "300 900",
  display: "swap",
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "BookingTours Admin",
  description: "BookingTours Admin Dashboard: built for adventure operators",
};

const nav = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/bookings", label: "Bookings", icon: "ClipboardList" },
  { href: "/new-booking", label: "New Booking", icon: "PlusSquare" },
  { href: "/slots", label: "Slots", icon: "CalendarRange" },
  { href: "/refunds", label: "Refunds", icon: "Landmark" },
  { href: "/inbox", label: "Inbox", icon: "MessageSquareText" },
  { href: "/vouchers", label: "Vouchers", icon: "Ticket" },
  { href: "/invoices", label: "Invoices", icon: "Receipt" },
  { href: "/broadcasts", label: "Broadcasts", icon: "Megaphone" },
  { href: "/pricing", label: "Peak Pricing", icon: "BadgeDollarSign" },
  { href: "/reports", label: "Reports", icon: "LineChart" },
  { href: "/marketing", label: "Marketing", icon: "Mail" },
  { href: "/ai-usage", label: "AI Usage", icon: "LineChart", privilegedOnly: true },
  { href: "/partnerships", label: "Partners", icon: "Users", privilegedOnly: true },
  { href: "/reviews", label: "Reviews", icon: "Star" },
  // privilegedOnly — hidden from ADMIN; visible to MAIN_ADMIN and SUPER_ADMIN
  { href: "/billing", label: "Billing", icon: "Receipt", privilegedOnly: true },
  // MVP: temporarily hidden — uncomment + remove from HIDDEN_FOR_MVP in proxy.ts to re-enable
  // { href: "/settings/ota", label: "OTA Channels", icon: "Globe", privilegedOnly: true },
  { href: "/settings/chat-faq", label: "Chat FAQ", icon: "MessageCircle", privilegedOnly: true },
  { href: "/settings", label: "Settings", icon: "Settings", privilegedOnly: true },
  // superAdminOnly — visible to SUPER_ADMIN only
  // MVP: temporarily hidden — uncomment + remove from HIDDEN_FOR_MVP in proxy.ts to re-enable
  // { href: "/ota-drift", label: "OTA Drift", icon: "Warning", superAdminOnly: true },
  { href: "/privacy/data-requests", label: "Data Requests", icon: "Shield", privilegedOnly: true },
  { href: "/super-admin", label: "Super Admin", icon: "Shield", superAdminOnly: true },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`light ${jakarta.className} ${jakarta.variable} ${geistMono.variable} ${satoshi.variable}`} suppressHydrationWarning>
      <body className="bg-[var(--ck-bg)] text-[var(--ck-text)] antialiased transition-colors duration-200">
        <ThemeProvider>
          <AppNotifications />
          <AuthGate>
            <AppShell nav={nav}>{children}</AppShell>
          </AuthGate>
        </ThemeProvider>
      </body>
    </html>
  );
}
