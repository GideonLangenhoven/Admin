`send-email` edge function

Required env vars:

- `RESEND_API_KEY`
- `EMAIL_FROM` optional, defaults to `Cape Kayak Adventures <bookings@capekayak.co.za>`

Supported `type` values:

- `BOOKING_CONFIRM`
- `PAYMENT_LINK`
- `ADMIN_SETUP`
- `ADMIN_WELCOME`
- `CANCELLATION`
- `TRIP_PHOTOS`
- `INVOICE`

Invoice behavior:

- Sends a normal HTML email body
- Attaches a generated PDF invoice
- Does not send raw invoice HTML in the email body
