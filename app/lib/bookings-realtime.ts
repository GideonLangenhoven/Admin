type RealtimePayload = {
  new?: {
    business_id?: string | null;
  } | null;
};

export function bookingRealtimeFilter(businessId: string): string {
  return `business_id=eq.${businessId}`;
}

export function shouldRefreshBookingsForPayload(payload: RealtimePayload, businessId: string): boolean {
  return payload.new?.business_id === businessId;
}
