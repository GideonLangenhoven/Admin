"use client";
import { createContext, useContext, useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

interface BusinessContextValue {
    businessId: string;
    businessName: string;
    staffName?: string;
    role: string;
    logoUrl: string;
    timezone: string;
    subscriptionStatus?: string;
    yocoTestMode?: boolean;
    readOnly?: boolean;
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
    useEffect(() => {
        Sentry.setTag("business_id", value.businessId || undefined);
        return () => Sentry.setTag("business_id", undefined);
    }, [value.businessId]);
    // Operator changes remount scoped UI state, including pending forms and
    // old query results. Refreshing the SAME operator does not reset the page.
    return <BusinessContext.Provider key={value.businessId} value={value}>{children}</BusinessContext.Provider>;
}

export function useBusinessContext(): BusinessContextValue {
    const ctx = useContext(BusinessContext);
    if (!ctx) throw new Error("useBusinessContext must be used inside BusinessProvider");
    return ctx;
}
