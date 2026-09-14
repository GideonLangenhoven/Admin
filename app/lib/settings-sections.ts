// Shared between app/settings/page.tsx (an operator managing their own
// sub-admins) and app/super-admin/page.tsx (the platform superadmin managing
// any business's admins) so the two never drift on which sections are
// delegatable.
export const SETTINGS_SECTIONS = [
    { key: "tours", label: "Tours & Activities" },
    { key: "addons", label: "Booking Add-Ons" },
    { key: "external", label: "External Booking" },
    { key: "site", label: "Booking Site Config" },
    { key: "email", label: "Email Customisation" },
    { key: "invoice", label: "Invoice Details" },
    // "credentials" (payment + WhatsApp secrets) is intentionally NOT delegatable:
    // the /api/credentials routes hard-require MAIN_ADMIN/SUPER_ADMIN, so granting
    // a sub-admin the permission only produced a visible-but-unsaveable section.
] as const;
export type SettingsSectionKey = typeof SETTINGS_SECTIONS[number]["key"];
