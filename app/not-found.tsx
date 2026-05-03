import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--ck-bg)" }}>
      <div className="text-center max-w-sm">
        <p className="text-6xl font-extrabold mb-2" style={{ color: "var(--ck-accent)" }}>404</p>
        <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--ck-text-strong)" }}>Page not found</h1>
        <p className="text-sm mb-6" style={{ color: "var(--ck-text-muted)" }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--ck-accent)" }}
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
