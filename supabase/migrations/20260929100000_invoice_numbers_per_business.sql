-- next_invoice_number starts at INV-00001 for each business. The old global
-- uniqueness constraint prevents the second business from saving its invoice.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_business_invoice_number_idx
  ON public.invoices (business_id, invoice_number);

DO $$
DECLARE global_index record;
BEGIN
  FOR global_index IN
    SELECT i.relname AS index_name, c.conname AS constraint_name
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    LEFT JOIN pg_constraint c ON c.conindid = x.indexrelid
    WHERE x.indrelid = 'public.invoices'::regclass
      AND x.indisunique AND x.indnkeyatts = 1
      AND (c.contype = 'u' OR c.oid IS NULL)
      AND x.indkey[0] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.invoices'::regclass AND attname = 'invoice_number'
      )
  LOOP
    IF global_index.constraint_name IS NULL THEN
      EXECUTE format('DROP INDEX public.%I', global_index.index_name);
    ELSE
      EXECUTE format('ALTER TABLE public.invoices DROP CONSTRAINT %I', global_index.constraint_name);
    END IF;
  END LOOP;
END $$;
