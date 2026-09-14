-- Remediation reschedules (operator-cancelled booking revived via credit claim)
-- may reduce the party size; the yoco-webhook needs the chosen qty to finalise
-- the swap after the uplift payment. NULL = qty unchanged.
alter table pending_reschedules add column if not exists new_qty integer;
