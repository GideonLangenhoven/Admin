import { handleBookingArrivalRequest } from "@/app/lib/booking-arrivals-server";

export async function POST(req: Request) {
  const requested = new URL(req.url).searchParams.get("source");
  const source = requested === "dashboard" || requested === "bookings" ? requested : "simple-view";
  return handleBookingArrivalRequest(req, source);
}
