-- area_report runs with the caller's rights (row rules already limit it to admins); one write policy per action.
-- Applied as migration hub_area_report_invoker.
alter function public.area_report() security invoker;
create index if not exists credit_apps_created_by_idx on public.credit_applications(created_by);
drop policy branches_owner_write on public.branches;
create policy branches_owner_insert on public.branches for insert to authenticated with check (private.is_store_owner(store_id));
create policy branches_owner_update on public.branches for update to authenticated using (private.is_store_owner(store_id)) with check (private.is_store_owner(store_id));
create policy branches_owner_delete on public.branches for delete to authenticated using (private.is_store_owner(store_id));
drop policy network_admin_write on public.network_docs;
create policy network_admin_insert on public.network_docs for insert to authenticated with check (private.is_admin());
create policy network_admin_update on public.network_docs for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy network_admin_delete on public.network_docs for delete to authenticated using (private.is_admin());
