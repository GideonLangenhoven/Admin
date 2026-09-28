import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BookingTours Admin",
    short_name: "BookingTours",
    description: "Operator inbox and bookings",
    start_url: "/inbox",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b4236",
    icons: [{ src: "/icon.png", sizes: "any", type: "image/png" }],
  };
}
