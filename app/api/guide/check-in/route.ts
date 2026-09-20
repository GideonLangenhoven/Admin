import { handleBookingArrivalRequest } from "@/app/lib/booking-arrivals-server";

export async function POST(req: Request) {
  return handleBookingArrivalRequest(req, "guide-pwa");
}
