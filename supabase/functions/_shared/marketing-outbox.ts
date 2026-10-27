// Legacy outbox bodies have no reliable promotional purpose or permission evidence.
// Only a cancellation generated for this tenant and booking can continue here.
export function operationalCancellationFollowup(
  businessId: string,
  message: { message_type?: string; booking_id?: string },
  booking: { id?: string; business_id?: string; status?: string } | null,
): boolean {
  return message.message_type === "CANCEL_FOLLOWUP" && !!message.booking_id &&
    booking?.id === message.booking_id && booking.business_id === businessId && booking.status === "CANCELLED";
}
