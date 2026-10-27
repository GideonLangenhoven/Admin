"use client";
import { useEffect, useState, type ReactNode } from "react";
// Copied only into the isolated synthetic preview, never imported by the app.
import { BusinessProvider as Provider } from "../../components/BusinessContext";

export function BusinessProvider({ children }: { children: ReactNode; value?: unknown }) {
  const [identity, setIdentity] = useState<{ role: string; businessId: string; readOnly: boolean } | null>(null);
  useEffect(() => {
    const update = () => {
      const params = new URLSearchParams(window.location.search);
      setIdentity({ role: params.get("role") || "MAIN_ADMIN", businessId: params.get("business") || "10000000-0000-4000-8000-000000000001", readOnly: params.has("readonly") });
    };
    update(); window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return identity && <Provider value={{ ...identity, businessName: "Example Tours (synthetic)", staffName: "Practice Operator", logoUrl: "", timezone: "Africa/Johannesburg", subscriptionStatus: "ACTIVE" }}>{children}</Provider>;
}
