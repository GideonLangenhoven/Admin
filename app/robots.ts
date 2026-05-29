import type { MetadataRoute } from "next";

// Admin dashboard is private — keep it out of all search indexes.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
