"use client";
import { Suspense } from "react";
import GuideDay from "@/components/guide/GuideDay";
import { useBusinessContext } from "@/components/BusinessContext";
export default function SimplePhotosPage() {
  const { role } = useBusinessContext();
  return role === "GUIDE" ? <Suspense><GuideDay photos /></Suspense> : <p>Manage trip photos in the full dashboard.</p>;
}
