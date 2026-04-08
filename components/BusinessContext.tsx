"use client";
import { createContext, useContext } from "react";

interface BusinessContextValue {
    businessId: string;
    businessName: string;
    role: string;
    logoUrl: string;
    timezone: string;
    subscriptionStatus?: string;
    operators?: Array<{
        id: string;
        name: string;
        logoUrl?: string;
    }>;
    switchOperator?: (businessId: string) => void;
}

var BusinessContext = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ value, children }: { value: BusinessContextValue; children: React.ReactNode }) {
    return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusinessContext(): BusinessContextValue {
    var ctx = useContext(BusinessContext);
    if (!ctx) throw new Error("useBusinessContext must be used inside BusinessProvider");
    return ctx;
}
