import type { Metadata, Viewport } from "next";
import GuideServiceWorker from "@/components/GuideServiceWorker";
import GuideShell from "./GuideShell";

export const metadata: Metadata = {
  title: "Guide · BookingTours",
  manifest: "/guide/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#10241B",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GuideServiceWorker />
      <GuideShell>{children}</GuideShell>
    </>
  );
}
