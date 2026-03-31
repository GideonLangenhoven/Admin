"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NotificationBadge from "./NotificationBadge";
import RefundBadge from "./RefundBadge";
import SignOutButton from "./SignOutButton";

type NavItem = { href: string; label: string; icon: string };

export default function MobileMenuDrawer({ nav }: { nav: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMounted(true), []);

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const drawer = (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[9998] bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 left-0 z-[9999] flex flex-col overflow-hidden transition-transform duration-200 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ backgroundColor: "#101828", width: "16rem", height: "100dvh" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#2a3a54] p-5">
          <h1 className="text-lg font-semibold tracking-tight text-white">Cape Kayak</h1>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex items-center justify-center w-8 h-8 rounded-lg text-[#7a8ba6] hover:text-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 space-y-1.5 overflow-y-auto p-3">
          {nav.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium ${
                  active
                    ? "bg-[#16243a] text-white"
                    : "text-[#c8d4e7] hover:bg-[#16243a] hover:text-white"
                }`}
              >
                <span className="text-base">{n.icon}</span>
                <span className="flex-1">{n.label}</span>
                {n.href === "/inbox" && <NotificationBadge />}
                {n.href === "/refunds" && <RefundBadge />}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-[#2a3a54]">
          <SignOutButton />
        </div>
      </div>
    </>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--ck-text-muted)] hover:bg-[var(--ck-bg-subtle)] hover:text-[var(--ck-text-strong)]"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {mounted && createPortal(drawer, document.body)}
    </>
  );
}
