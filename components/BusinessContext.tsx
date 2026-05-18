"use client";
import { createContext, useContext } from "react";

interface BusinessContextValue {
    businessId: string;
    businessName: string;
    role: string;
    logoUrl: string;
    timezone: string;
    subscriptionStatus?: string;
    yocoTestMode?: boolean;
    operators?: Array<{
        id: string;
        name: string;
        logoUrl?: string;
    }>;
    switchOperator?: (businessId: string) => void;
    // Z1: re-fetch the active business row and update name/logo state so the
    // sidebar reflects a Settings edit without a hard page reload.
    refreshBusiness?: () => Promise<void> | void;
}

const BusinessContext = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ value, children }: { value: BusinessContextValue; children: React.ReactNode }) {
    return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusinessContext(): BusinessContextValue {
    const ctx = useContext(BusinessContext);
    if (!ctx) throw new Error("useBusinessContext must be used inside BusinessProvider");
    return ctx;
}
