// Sections a MAIN_ADMIN can hide from an OPERATOR-level admin, at their
// discretion. Stored per-admin in admin_users.settings_permissions under the
// key "hide:<sectionKey>" = true. Absent/false = visible (the default), so
// existing operators keep seeing everything until something is explicitly hidden.
//
// Keys that start with "/" match a nav href; "dashboard_reports" is the
// dashboard revenue panel (not a nav item).
export const OPERATOR_HIDEABLE_SECTIONS = [
    { key: "dashboard_reports", label: "Dashboard revenue panel" },
    { key: "/reports", label: "Reports" },
    { key: "/marketing", label: "Marketing" },
    { key: "/reviews", label: "Reviews" },
] as const;

export function isSectionHidden(
    perms: Record<string, unknown> | null | undefined,
    sectionKey: string,
): boolean {
    return !!perms && perms[`hide:${sectionKey}`] === true;
}
