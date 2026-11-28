-- The owner member is added by an AFTER trigger, so INSERT ... RETURNING needs the owner to read the new row directly.
-- Applied as migration hub_owner_reads_own_store.
drop policy stores_read on public.stores;
create policy stores_read on public.stores for select to authenticated using (owner_id = (select auth.uid()) or public.is_member(id) or public.is_admin());
