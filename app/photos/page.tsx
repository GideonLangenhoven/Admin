"use client";
import TripPhotosWorkspace from "@/components/photos/TripPhotosWorkspace";
import { useBusinessContext } from "@/components/BusinessContext";
export default function PhotosPage() {
  const { businessId } = useBusinessContext();
  return <TripPhotosWorkspace key={businessId} />;
}
