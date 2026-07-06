import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-20">
      <div className="ui-card anim-fade-up w-full max-w-sm px-10 py-12 text-center">
        <div className="ui-icon-chip mx-auto mb-5 !h-14 !w-14 !rounded-full" style={{ background: "var(--ck-surface-sunken)" }}>
          <span className="font-mono text-[15px] font-semibold tracking-[0.08em]" style={{ color: "var(--ck-text-muted)" }}>404</span>
        </div>
        <h1 className="font-display mb-2 text-[22px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Page not found</h1>
        <p className="mb-7 text-sm" style={{ color: "var(--ck-text-muted)" }}>
          This page doesn&apos;t exist or has been moved.
        </p>
        <Link href="/" className="ui-btn ui-btn-primary inline-flex !px-6">
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
