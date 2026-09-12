-- Correction: a column-level REVOKE cannot narrow a pre-existing blanket
-- table-level GRANT UPDATE ON admin_users TO authenticated — Postgres grant
-- semantics don't work that way. Revoke the table-level UPDATE entirely
-- instead. Confirmed no legitimate client code updates admin_users directly
-- (every write goes through service-role app/api/admin/*/route.ts), so no
-- columns need to be re-granted.
revoke update on public.admin_users from authenticated;;
