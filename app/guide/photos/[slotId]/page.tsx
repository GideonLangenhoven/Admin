"use client";
import { use } from "react";
import TripPhotosWorkspace from "@/components/photos/TripPhotosWorkspace";
import { useBusinessContext } from "@/components/BusinessContext";
export default function GuidePhotosPage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = use(params);
  const { businessId } = useBusinessContext();
  return <TripPhotosWorkspace key={businessId + slotId} initialSlotId={slotId} />;
}
