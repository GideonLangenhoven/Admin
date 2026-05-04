import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AuthGate from "../components/AuthGate";
import AppShell from "../components/AppShell";
import AppNotifications from "../components/AppNotifications";
import ThemeProvider from "../components/ThemeProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BookingTours Admin",
  description: "BookingTours Admin Dashboard — Built for adventure operators",
  icons: { icon: "/favicon.ico" },
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
  { href: "/weather", label: "Weather", icon: "CloudSun" },
  { href: "/photos", label: "Photos", icon: "Camera" },
  { href: "/broadcasts", label: "Broadcasts", icon: "Megaphone" },
  { href: "/pricing", label: "Peak Pricing", icon: "BadgeDollarSign" },
  { href: "/customers", label: "Customers", icon: "Users" },
  { href: "/reports", label: "Reports", icon: "LineChart" },
  { href: "/marketing", label: "Marketing", icon: "Mail" },
  { href: "/reviews", label: "Reviews", icon: "Star" },
  // privilegedOnly — hidden from ADMIN; visible to MAIN_ADMIN and SUPER_ADMIN only
  { href: "/settings/ota", label: "OTA Channels", icon: "Globe", privilegedOnly: true },
  { href: "/ota-drift", label: "OTA Drift", icon: "Warning", privilegedOnly: true },
  { href: "/settings", label: "Settings", icon: "Settings", privilegedOnly: true },
  { href: "/super-admin", label: "Super Admin", icon: "Shield", privilegedOnly: true },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`light ${inter.className}`} suppressHydrationWarning>
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
