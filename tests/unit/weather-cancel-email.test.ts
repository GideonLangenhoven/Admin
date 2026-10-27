import { describe, expect, it } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// M11: the weather cancellation read as the general one: same subject and
// heading, and a single "Manage My Booking" button where the general email
// lists the guest's options. It now reads as the weather email throughout,
// with the weather banner and a link for each option.
const sendEmail = "supabase/functions/send-email/index.ts";
const manage = "https://kayak.example.invalid/my-bookings";
// What weather-cancel sends for a paid booking when the operator offers choices.
const weather = {
  is_weather: true, customer_name: "Guest", ref: "DF013E88", tour_name: "Seal Snorkel", start_time: "Fri, 30 Oct, 14:00",
  reason: "weather conditions", total_amount: 1500, offer_choice: true, notification_only: false, _manageUrl: manage,
};
const isWeatherCancel = sourceFunction(sendEmail, "isWeatherCancel", {});
const render = sourceFunction(sendEmail, "cancellationHtml", { heroImg: (key: string) => `<!--${key}-->`, isWeatherCancel });

describe("weather cancellation email", () => {
  it("links each of the guest's options to My Bookings", () => {
    const html = render(weather);
    for (const option of ["Choose a New Date", "Get a Voucher", "Request a Refund"]) {
      expect(html).toMatch(new RegExp(`href="${manage}"[^>]*>${option}</a>`));
    }
  });

  it("uses the weather banner, heading and subject", () => {
    const html = render(weather);
    expect(html).toContain("<!--IMG_CANCEL_WEATHER-->");
    expect(html).toContain("Trip Cancelled due to Weather");
    const subject = sourceFunction(sendEmail, "cancellationSubject", { isWeatherCancel });
    expect(subject(weather)).toBe("Cape Kayak - Trip Cancelled due to Weather (Ref: DF013E88)");
    expect(subject({ ...weather, is_weather: false, reason: "Guide unavailable" })).toBe("Cape Kayak - Booking Cancelled (Ref: DF013E88)");
    expect(render({ ...weather, is_weather: false, reason: "Guide unavailable" })).toContain("<!--IMG_CANCEL-->");
  });
});
