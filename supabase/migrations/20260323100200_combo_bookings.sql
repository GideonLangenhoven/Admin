-- Combo bookings: tracks a paired booking across two businesses
CREATE TABLE IF NOT EXISTS public.combo_bookings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  combo_offer_id uuid NOT NULL REFERENCES public.combo_offers(id),
  booking_a_id uuid REFERENCES public.bookings(id),
  booking_b_id uuid REFERENCES public.bookings(id),
  combo_total numeric NOT NULL CHECK (combo_total >= 0),
  split_a_amount numeric NOT NULL CHECK (split_a_amount >= 0),
  split_b_amount numeric NOT NULL CHECK (split_b_amount >= 0),
  paysafe_payment_handle text,
  paysafe_payment_id text,
  paysafe_settlement_id text,
  payment_status text NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
  customer_name text,
  customer_email text,
  customer_phone text,
  created_at timestamptz DEFAULT now() NOT NULL,

  CONSTRAINT unique_booking_a UNIQUE (booking_a_id),
  CONSTRAINT unique_booking_b UNIQUE (booking_b_id)
);

CREATE INDEX IF NOT EXISTS idx_combo_bookings_offer ON public.combo_bookings (combo_offer_id);
CREATE INDEX IF NOT EXISTS idx_combo_bookings_payment_status ON public.combo_bookings (payment_status);

ALTER TABLE public.combo_bookings ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.combo_bookings TO service_role;
