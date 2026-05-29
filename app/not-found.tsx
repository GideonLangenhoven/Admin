import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-4">
      <div className="w-16 h-16 rounded-full bg-[var(--ck-surface,#f3f4f6)] flex items-center justify-center mb-6">
        <span className="text-2xl font-bold text-[var(--ck-text-muted,#6b7280)]">404</span>
      </div>
      <h1 className="text-xl font-bold text-[var(--ck-text)] mb-2">Page not found</h1>
      <p className="text-sm text-[var(--ck-text-muted,#6b7280)] mb-6 max-w-sm">
        This page doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-[var(--ck-accent,#2563eb)] text-white hover:opacity-90 transition-opacity"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
