---
title: Trip Photos
route: /photos
required_role: OPERATOR
---

Trip Photos prepares and shares a trip's photos and videos with its lead bookers. Reach [Trip Photos](/photos) from the Dashboard's **Photo upload backlog** card or open /photos directly.

## Sending photos

1. Select a recent trip (bookings from the last 7 days, grouped by date).
2. Upload images or videos to the connected **Google Drive**, or paste photo URLs individually or as a batch separated by newlines or commas. Uploading creates a trip folder and prepares its link; it does not notify guests. Failed uploads remain selected for retry.
3. Review the gallery and choose **Send photos and thank you email**, then confirm. Photo links are saved for My Bookings and sent in the thank-you email and WhatsApp message where those contact details are available. The WhatsApp message includes the trip's links directly; there is no separate YES-reply step for identifying the trip.

A progress bar and returned results show sending status and failures per channel. WhatsApp delivery follows the normal service-window rules. The dashboard backlog counts trips without saved photo links, so it can clear after upload/link preparation before notification delivery is complete.

## Recent photo links

**Recent Photo Links** shows saved galleries and folders. A saved link is available for review and guest access; it does not prove an email or WhatsApp notification was delivered. A MAIN_ADMIN connects Google Drive under [Integration Credentials](/settings#credentials).

## Photos through the shared guide login

Guides signed in as `guide@operator-name` choose **Trip photos** from a departure in [Guide Simple View](/simpleguide). This opens the same Photos workspace as the main dashboard, with that departure selected. Guides can choose recent trips, upload images and videos to the operator's connected Google Drive, add or bulk-import photo links, review recent photo links, and choose **Send photos and thank you email**. Confirming sends the same photo/thank-you email and WhatsApp photo message to the trip's eligible lead bookers, using the operator's existing templates and contact details. Uploading alone does not notify guests.

Failed uploads remain selected for retry; earlier successful folder links are retained. Partial message failures remain visible so the guide can correct them before another send. Trip selection clears the previous trip's editable links. Guides can only view, upload and send for their own operator; they cannot connect/disconnect Drive, choose arbitrary recipients or open office/marketing settings. If Google Drive is disconnected, paste photo links or ask the main admin to connect it in Settings.
