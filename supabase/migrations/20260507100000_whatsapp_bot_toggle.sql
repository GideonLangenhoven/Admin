-- Prompt 47: WhatsApp bot mode toggle
-- Allows tenants to control when the AI bot replies to WhatsApp messages.

-- 1. Create the enum type
DO $$ BEGIN
  CREATE TYPE whatsapp_bot_mode AS ENUM ('OFF', 'ALWAYS_ON', 'OUTSIDE_HOURS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add mode columns to businesses
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS whatsapp_bot_mode whatsapp_bot_mode NOT NULL DEFAULT 'ALWAYS_ON',
  ADD COLUMN IF NOT EXISTS whatsapp_bot_mode_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_bot_mode_changed_by uuid REFERENCES admin_users(id);

-- 3. Add bot_skipped_reason to chat_messages for analytics
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS bot_skipped_reason text;

-- 4. Helper function: is it currently inside business hours for a tenant?
CREATE OR REPLACE FUNCTION is_inside_business_hours(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tz text;
  v_hours jsonb;
  v_now timestamptz := now();
  v_local_time time;
  v_local_dow text;
  v_day jsonb;
  v_open time;
  v_close time;
BEGIN
  SELECT timezone, business_hours INTO v_tz, v_hours
  FROM businesses WHERE id = p_business_id;

  IF v_hours IS NULL OR v_tz IS NULL THEN
    RETURN true;  -- no hours configured → treat as always inside (safe default)
  END IF;

  v_local_time := (v_now AT TIME ZONE v_tz)::time;
  v_local_dow := lower(to_char(v_now AT TIME ZONE v_tz, 'dy'));

  v_day := v_hours -> v_local_dow;
  IF v_day IS NULL OR (v_day ->> 'closed')::boolean IS TRUE THEN
    RETURN false;
  END IF;

  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;

  IF v_open IS NULL OR v_close IS NULL THEN
    RETURN true;  -- malformed hours entry → treat as open
  END IF;

  RETURN v_local_time >= v_open AND v_local_time < v_close;
END;
$$;

GRANT EXECUTE ON FUNCTION is_inside_business_hours(uuid) TO authenticated, service_role;
