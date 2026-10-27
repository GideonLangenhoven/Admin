---
title: Trip Photos
route: /photos
required_role: OPERATOR
---

Trip Photos prepares and shares a trip's photos and videos with its lead bookers. Reach [Trip Photos](/photos) from the Dashboard's **Photo upload backlog** card or open /photos directly.

## Sending photos

1. Select a recent trip (bookings from the last 7 days, grouped by date).
2. Upload images or videos to the connected **Google Drive**, or paste photo URLs individually or as a batch separated by newlines or commas. Uploading creates a trip folder and prepares its link; it does not notify guests. Failed uploads remain selected for retry.
3. Review the gallery and choose **Send Photos to Lead Bookers**, then confirm. Photo links are saved for My Bookings and sent in the thank-you email and WhatsApp message where those contact details are available. The WhatsApp message includes the trip's links directly; there is no separate YES-reply step for identifying the trip.

A progress bar and returned results show sending status and failures per channel. WhatsApp delivery follows the normal service-window rules. The dashboard backlog counts trips without saved photo links, so it can clear after upload/link preparation before notification delivery is complete.

## Recent photo links

**Recent Photo Links** shows saved galleries and folders. A saved link is available for review and guest access; it does not prove an email or WhatsApp notification was delivered. A MAIN_ADMIN connects Google Drive under [Integration Credentials](/settings#credentials).

## Photos through the shared guide login

Guides signed in as `guide@operator-name` use **Trip photos** in [Simple View](/simple/photos), select a day and open a departure's gallery. They can view and upload images for their own operator's trips using its connected Google Drive. Upload images up to 20 MB each. They cannot send thank-you emails or WhatsApp messages; dashboard staff handle guest notifications separately. If Google Drive is not connected or an upload fails, ask the main admin to check the connection and retry the failed image.
