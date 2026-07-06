import type { Metadata } from "next";
import { Fraunces, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import AuthGate from "../components/AuthGate";
import AppShell from "../components/AppShell";
import AppNotifications from "../components/AppNotifications";
import ThemeProvider from "../components/ThemeProvider";

/* Brand type system (docs/BRAND.md + docs/ADMIN_REDESIGN_SPEC.md):
   Fraunces — editorial display face for page titles and hero numerals.
   Inter — all UI and data. Geist Mono — the instrument voice (labels, timestamps). */
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-display", axes: ["opsz"] });

export const metadata: Metadata = {
  title: "BookingTours Admin",
  description: "BookingTours Admin Dashboard — Built for adventure operators",
};

const nav = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/bookings", label: "Bookings", icon: "ClipboardList" },
  { href: "/bookings/pending-reschedules", label: "Pending Reschedules", icon: "Clock" },
  { href: "/new-booking", label: "New Booking", icon: "PlusSquare" },
  { href: "/slots", label: "Slots", icon: "CalendarRange" },
  { href: "/guide", label: "Guide", icon: "Users" },
  { href: "/refunds", label: "Refunds", icon: "Landmark" },
  { href: "/inbox", label: "Inbox", icon: "MessageSquareText" },
  { href: "/notifications", label: "Notifications", icon: "Warning", privilegedOnly: true },
  { href: "/vouchers", label: "Vouchers", icon: "Ticket" },
  { href: "/invoices", label: "Invoices", icon: "Receipt" },
  { href: "/photos", label: "Photos", icon: "Camera" },
  { href: "/broadcasts", label: "Broadcasts", icon: "Megaphone" },
  { href: "/pricing", label: "Peak Pricing", icon: "BadgeDollarSign" },
  { href: "/reports", label: "Reports", icon: "LineChart" },
  { href: "/marketing", label: "Marketing", icon: "Mail" },
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
    <html lang="en" className={`light ${inter.className} ${inter.variable} ${geistMono.variable} ${fraunces.variable}`} suppressHydrationWarning>
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
