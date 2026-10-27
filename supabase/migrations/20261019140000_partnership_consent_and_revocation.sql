BEGIN;

-- Old API responses exposed invitation tokens to the sender. Withdraw those
-- links; recipients can still accept pending invitations from their dashboard.
UPDATE public.business_partnerships SET invite_token = NULL WHERE invite_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_combo_offer_partnerships(p_offer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  offer public.combo_offers;
  collector uuid;
  partner uuid;
  partnership_status text;
BEGIN
  SELECT * INTO offer FROM public.combo_offers WHERE id = p_offer_id;
  IF NOT FOUND OR NOT offer.active THEN
    RAISE EXCEPTION 'This combo offer is no longer available.' USING ERRCODE = '23514';
  END IF;
  collector := coalesce(offer.business_a_id, offer.created_by_business_id, offer.created_by,
    (SELECT i.business_id FROM public.combo_offer_items i WHERE i.combo_offer_id = offer.id ORDER BY i.position LIMIT 1));
  IF collector IS NULL THEN
    RAISE EXCEPTION 'The combo offer has no operator.' USING ERRCODE = '23514';
  END IF;
  FOR partner IN
    SELECT business_id FROM (
      SELECT i.business_id FROM public.combo_offer_items i WHERE i.combo_offer_id = offer.id
      UNION SELECT offer.business_a_id
      UNION SELECT offer.business_b_id
    ) parties WHERE business_id IS NOT NULL AND business_id <> collector ORDER BY business_id
  LOOP
    -- Share locks serialize offer activation/checkout with partnership revocation.
    SELECT p.status INTO partnership_status FROM public.business_partnerships p
      WHERE p.business_a_id = least(collector, partner) AND p.business_b_id = greatest(collector, partner)
      FOR SHARE;
    IF NOT FOUND OR partnership_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'An active partnership is required with every operator in this combo.' USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_combo_offer_partnerships()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE offer_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'combo_offers' THEN
    IF NOT NEW.active THEN RETURN NEW; END IF;
    offer_id := NEW.id;
  ELSE
    offer_id := NEW.combo_offer_id;
    IF TG_TABLE_NAME = 'combo_offer_items' AND NOT EXISTS (
      SELECT 1 FROM public.combo_offers o WHERE o.id = offer_id AND o.active
    ) THEN RETURN NEW; END IF;
  END IF;
  PERFORM public.assert_combo_offer_partnerships(offer_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_revoked_partnership_offers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.combo_offers o SET active = false
  WHERE o.active AND (
    o.partnership_id = NEW.id
    OR (
      coalesce(o.business_a_id, o.created_by_business_id, o.created_by,
        (SELECT first_item.business_id FROM public.combo_offer_items first_item WHERE first_item.combo_offer_id = o.id ORDER BY first_item.position LIMIT 1)) IN (NEW.business_a_id, NEW.business_b_id)
      AND EXISTS (
        SELECT 1 FROM public.combo_offer_items i
        WHERE i.combo_offer_id = o.id
          AND i.business_id = CASE WHEN coalesce(o.business_a_id, o.created_by_business_id, o.created_by,
            (SELECT first_item.business_id FROM public.combo_offer_items first_item WHERE first_item.combo_offer_id = o.id ORDER BY first_item.position LIMIT 1)) = NEW.business_a_id
            THEN NEW.business_b_id ELSE NEW.business_a_id END
      )
    )
  );
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_combo_offer_items_business_offer
  ON public.combo_offer_items (business_id, combo_offer_id);

DROP TRIGGER IF EXISTS partnership_deactivate_offers ON public.business_partnerships;
CREATE TRIGGER partnership_deactivate_offers AFTER UPDATE OF status ON public.business_partnerships
  FOR EACH ROW WHEN (NEW.status <> 'ACTIVE' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.deactivate_revoked_partnership_offers();

DROP TRIGGER IF EXISTS combo_offer_partnership_guard ON public.combo_offers;
CREATE TRIGGER combo_offer_partnership_guard AFTER INSERT OR UPDATE ON public.combo_offers
  FOR EACH ROW EXECUTE FUNCTION public.guard_combo_offer_partnerships();

DROP TRIGGER IF EXISTS combo_item_partnership_guard ON public.combo_offer_items;
CREATE TRIGGER combo_item_partnership_guard AFTER INSERT OR UPDATE ON public.combo_offer_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_combo_offer_partnerships();

DROP TRIGGER IF EXISTS combo_checkout_partnership_guard ON public.combo_bookings;
CREATE TRIGGER combo_checkout_partnership_guard BEFORE INSERT ON public.combo_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_combo_offer_partnerships();

REVOKE ALL ON FUNCTION public.assert_combo_offer_partnerships(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_combo_offer_partnerships(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.guard_combo_offer_partnerships() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_revoked_partnership_offers() FROM PUBLIC, anon, authenticated;

-- Repair offers missed by earlier revocations without changing historical sales.
DO $$
DECLARE offer_id uuid;
BEGIN
  FOR offer_id IN SELECT id FROM public.combo_offers WHERE active LOOP
    BEGIN
      PERFORM public.assert_combo_offer_partnerships(offer_id);
    EXCEPTION WHEN check_violation THEN
      UPDATE public.combo_offers SET active = false WHERE id = offer_id;
    END;
  END LOOP;
END;
$$;

COMMIT;
