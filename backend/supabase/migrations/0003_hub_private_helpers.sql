-- Helper and trigger functions move out of the API schema, so they cannot be called through /rest/v1/rpc.
-- Applied as migration hub_private_helpers.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter function public.is_admin() set schema private;
alter function public.is_member(uuid) set schema private;
alter function public.is_store_owner(uuid) set schema private;
alter function public.stores_add_owner() set schema private;
alter function public.stores_share_changed() set schema private;
alter function public.summaries_enforce() set schema private;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.is_member(uuid), private.is_store_owner(uuid) to authenticated;
create or replace function public.area_report() returns table (city text, stores bigint, sales_stores bigint, sales_30d numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(s.city, 'City not set') as city, count(distinct s.id) as stores,
         count(distinct s.id) filter (where m.sales is not null) as sales_stores,
         sum(coalesce((select sum((d->>'t')::numeric) from jsonb_array_elements(m.sales->'days') d), 0)) as sales_30d
  from public.stores s left join public.summaries m on m.store_id = s.id and m.branch_key = 'main'
  where private.is_admin() and s.deletion_requested_at is null
  group by 1 having count(distinct s.id) >= 5;
$$;
revoke execute on function public.area_report() from public, anon;
grant execute on function public.area_report() to authenticated;
