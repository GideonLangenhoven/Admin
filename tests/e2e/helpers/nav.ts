export interface NavItem {
  href: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/bookings", label: "Bookings" },
  { href: "/new-booking", label: "New Booking" },
  { href: "/slots", label: "Slots" },
  { href: "/refunds", label: "Refunds" },
  { href: "/inbox", label: "Inbox" },
  { href: "/vouchers", label: "Vouchers" },
  { href: "/invoices", label: "Invoices" },
  { href: "/weather", label: "Weather" },
  { href: "/photos", label: "Photos" },
  { href: "/broadcasts", label: "Broadcasts" },
  { href: "/pricing", label: "Peak Pricing" },
  { href: "/customers", label: "Customers" },
  { href: "/reports", label: "Reports" },
  { href: "/marketing", label: "Marketing" },
  { href: "/reviews", label: "Reviews" },
];

export const PRIVILEGED_NAV_ITEMS: NavItem[] = [
  { href: "/billing", label: "Billing" },
  { href: "/settings/ota", label: "OTA Channels" },
  { href: "/settings/chat-faq", label: "Chat FAQ" },
  { href: "/ota-drift", label: "OTA Drift" },
  { href: "/super-admin/data-requests", label: "Data Requests" },
  { href: "/settings", label: "Settings" },
  { href: "/super-admin", label: "Super Admin" },
];
