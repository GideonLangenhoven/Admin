-- The admin app has always subscribed to postgres_changes on bookings and
-- conversations (bookings page, dashboard, refund/inbox badges), but only
-- chat_messages was ever added to the realtime publication — so none of those
-- subscriptions fired and operators had to hard-reload to see new activity.
-- RLS is tenant-scoped on both tables (bookings_tenant_select /
-- conversations_tenant_select), so events only reach the owning tenant.
alter publication supabase_realtime add table bookings;
alter publication supabase_realtime add table conversations;
