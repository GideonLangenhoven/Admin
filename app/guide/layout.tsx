import type { Metadata, Viewport } from "next";
import GuideServiceWorker from "@/components/GuideServiceWorker";

export const metadata: Metadata = {
  title: "Guide — BookingTours",
  manifest: "/guide/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#1F7A8C",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GuideServiceWorker />
      {children}
    </>
  );
}
