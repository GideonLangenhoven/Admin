export interface NavItem {
  href: string;
  label: string;
}

// Mirrors the desktop nav in app/layout.tsx. Simple view is mobile/tablet only.
// Reviews, vouchers, and failed notifications live inside their parent sections.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/bookings", label: "Bookings" },
  { href: "/new-booking", label: "New Booking" },
  { href: "/slots", label: "Slots" },
  { href: "/refunds", label: "Refunds" },
  { href: "/inbox", label: "Inbox" },
  { href: "/invoices", label: "Invoices" },
  { href: "/broadcasts", label: "Broadcasts" },
  { href: "/pricing", label: "Peak Pricing" },
  { href: "/reports", label: "Reports" },
  { href: "/marketing", label: "Marketing" },
];

// Visible to MAIN_ADMIN and SUPER_ADMIN.
export const PRIVILEGED_NAV_ITEMS: NavItem[] = [
  { href: "/ai-usage", label: "AI" },
  { href: "/partnerships", label: "Partners" },
  { href: "/billing", label: "Billing" },
  { href: "/settings", label: "Settings" },
];

// Visible to SUPER_ADMIN only.
export const SUPER_ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/super-admin", label: "Super Admin" },
];
