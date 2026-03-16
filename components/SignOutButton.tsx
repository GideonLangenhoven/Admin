"use client";

export default function SignOutButton({ variant = "sidebar" }: { variant?: "sidebar" | "header" }) {
  function logout() {
    localStorage.removeItem("ck_admin_auth");
    localStorage.removeItem("ck_admin_role");
    localStorage.removeItem("ck_admin_email");
    window.location.reload();
  }

  if (variant === "header") {
    return (
      <button
        onClick={logout}
        className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
        style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-strong)" }}
      >
        Sign Out
      </button>
    );
  }

  return (
    <button
      onClick={logout}
      className="text-left px-4 py-3 text-xs font-medium transition-colors"
      style={{ color: "var(--ck-sidebar-muted)" }}
    >
      Sign Out
    </button>
  );
}
