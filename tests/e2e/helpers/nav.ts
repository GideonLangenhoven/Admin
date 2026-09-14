export interface NavItem {
  href: string;
  label: string;
}

// Mirrors the nav definition in app/layout.tsx. Weather/Photos/Customers pages
// still exist but were removed from the sidebar; OTA Channels/OTA Drift are
// MVP-hidden (commented out in layout.tsx and redirected by proxy.ts).
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/bookings", label: "Bookings" },
  { href: "/new-booking", label: "New Booking" },
  { href: "/slots", label: "Slots" },
  { href: "/refunds", label: "Refunds" },
  { href: "/inbox", label: "Inbox" },
  { href: "/vouchers", label: "Vouchers" },
  { href: "/invoices", label: "Invoices" },
  { href: "/broadcasts", label: "Broadcasts" },
  { href: "/pricing", label: "Peak Pricing" },
  { href: "/reports", label: "Reports" },
  { href: "/marketing", label: "Marketing" },
  { href: "/reviews", label: "Reviews" },
];

// Visible to MAIN_ADMIN and SUPER_ADMIN.
export const PRIVILEGED_NAV_ITEMS: NavItem[] = [
  { href: "/ai-usage", label: "AI Usage" },
  { href: "/partnerships", label: "Partners" },
  { href: "/billing", label: "Billing" },
  { href: "/settings/chat-faq", label: "Chat FAQ" },
  { href: "/settings", label: "Settings" },
  { href: "/privacy/data-requests", label: "Data Requests" },
];

// Visible to SUPER_ADMIN only.
export const SUPER_ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/super-admin", label: "Super Admin" },
];
