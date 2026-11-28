-- KWADERNO network hub: accounts, owner-chosen sharing, summaries, credit applications, guidance, reports.
-- Each sale, customers and utang names never come here: they stay on the store's phone.
-- Applied to Supabase project "kwaderno" (ap-southeast-1) as migration hub_core.

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  barangay text check (char_length(barangay) <= 120),
  city text check (char_length(city) <= 120),
  privacy_version text,
  consent_at timestamptz,
  share_learn boolean not null default false,  -- level 1
  share_sales boolean not null default false,  -- level 2
  share_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now()
);
create index stores_owner_idx on public.stores(owner_id);

create table public.store_members (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','staff')),
  added_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index store_members_user_idx on public.store_members(user_id);

create or replace function public.is_member(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.store_members m where m.store_id = s and m.user_id = (select auth.uid()));
$$;
create or replace function public.is_store_owner(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.store_members m where m.store_id = s and m.user_id = (select auth.uid()) and m.role = 'owner');
$$;

-- the creator becomes the owner member
create or replace function public.stores_add_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.store_members(store_id, user_id, role) values (new.id, new.owner_id, 'owner') on conflict do nothing;
  return new;
end $$;
create trigger stores_add_owner after insert on public.stores for each row execute function public.stores_add_owner();

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  address text check (char_length(address) <= 200),
  created_at timestamptz not null default now()
);
create index branches_store_idx on public.branches(store_id);

-- one row per store (branch_key 'main' = main store) holding ONLY what the owner chose to share
create table public.summaries (
  store_id uuid not null references public.stores(id) on delete cascade,
  branch_key text not null default 'main',
  basic jsonb not null default '{}'::jsonb,   -- always: product and low-stock counts, last active
  learn jsonb,                                -- level 1: products, stock, units sold, barcodes (no money)
  sales jsonb,                                -- level 2: daily totals, payment mix, stock value, total utang
  updated_at timestamptz not null default now(),
  primary key (store_id, branch_key)
);

-- the server enforces the owner's choice, whatever a client sends
create or replace function public.summaries_enforce() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st public.stores;
begin
  select * into st from public.stores where id = new.store_id;
  if st.deletion_requested_at is not null then
    raise exception 'store asked for deletion: nothing more is accepted' using errcode = 'P0001';
  end if;
  if not st.share_learn then new.learn := null; end if;
  if not st.share_sales then new.sales := null; end if;
  -- money never rides in level 1, names never anywhere
  if new.learn is not null then
    new.learn := new.learn - 'r30' - 'cost' - 'customers' - 'utang' - 'days' - 'mix';
  end if;
  if new.sales is not null then
    new.sales := new.sales - 'customers' - 'customerNames' - 'receipts';
  end if;
  new.basic := jsonb_build_object('products', new.basic->'products', 'lowStock', new.basic->'lowStock', 'lastActiveAt', new.basic->'lastActiveAt');
  new.updated_at := now();
  return new;
end $$;
create trigger summaries_enforce before insert or update on public.summaries for each row execute function public.summaries_enforce();

-- turning a level off removes what was already shared at that level
create or replace function public.stores_share_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.share_learn and not new.share_learn then update public.summaries set learn = null where store_id = new.id; end if;
  if old.share_sales and not new.share_sales then update public.summaries set sales = null where store_id = new.id; end if;
  return new;
end $$;
create trigger stores_share_changed after update of share_learn, share_sales on public.stores for each row execute function public.stores_share_changed();

-- level 3: one consent per application; nothing goes to a lender from here
create table public.credit_applications (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  consent_version text not null,
  status text not null default 'waiting' check (status in ('waiting','withdrawn')),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create index credit_apps_store_idx on public.credit_applications(store_id);

-- guidance down from the queen: engine pack, discount rules, insights, knowledge
create table public.network_docs (
  key text primary key check (key ~ '^[a-z0-9_-]{1,60}$'),
  body jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.admins enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.branches enable row level security;
alter table public.summaries enable row level security;
alter table public.credit_applications enable row level security;
alter table public.network_docs enable row level security;

create policy admins_self on public.admins for select to authenticated using (user_id = (select auth.uid()));

create policy stores_read on public.stores for select to authenticated using (public.is_member(id) or public.is_admin());
create policy stores_create on public.stores for insert to authenticated with check (owner_id = (select auth.uid()));
create policy stores_owner_update on public.stores for update to authenticated using (public.is_store_owner(id)) with check (public.is_store_owner(id));

create policy members_read on public.store_members for select to authenticated using (public.is_member(store_id) or public.is_admin());
create policy members_owner_add on public.store_members for insert to authenticated with check (public.is_store_owner(store_id) and role = 'staff');
create policy members_owner_remove on public.store_members for delete to authenticated using (public.is_store_owner(store_id) and role = 'staff');

create policy branches_read on public.branches for select to authenticated using (public.is_member(store_id) or public.is_admin());
create policy branches_owner_write on public.branches for all to authenticated using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id));

create policy summaries_read on public.summaries for select to authenticated using (public.is_member(store_id) or public.is_admin());
create policy summaries_member_insert on public.summaries for insert to authenticated with check (public.is_member(store_id));
create policy summaries_member_update on public.summaries for update to authenticated using (public.is_member(store_id)) with check (public.is_member(store_id));

create policy credit_read on public.credit_applications for select to authenticated using (public.is_member(store_id) or public.is_admin());
create policy credit_owner_apply on public.credit_applications for insert to authenticated with check (public.is_store_owner(store_id) and status = 'waiting' and created_by = (select auth.uid()));
create policy credit_owner_withdraw on public.credit_applications for update to authenticated using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id) and status = 'withdrawn');

create policy network_read on public.network_docs for select to authenticated using (true);
create policy network_admin_write on public.network_docs for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- reports up to Super Admin; outside exports use area_report, which leaves out areas with fewer than 5 stores
create or replace function public.area_report() returns table (city text, stores bigint, sales_stores bigint, sales_30d numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(s.city, 'City not set') as city, count(distinct s.id) as stores,
         count(distinct s.id) filter (where m.sales is not null) as sales_stores,
         sum(coalesce((select sum((d->>'t')::numeric) from jsonb_array_elements(m.sales->'days') d), 0)) as sales_30d
  from public.stores s left join public.summaries m on m.store_id = s.id and m.branch_key = 'main'
  where public.is_admin() and s.deletion_requested_at is null
  group by 1 having count(distinct s.id) >= 5;
$$;

revoke execute on function public.area_report() from public, anon;
grant execute on function public.area_report() to authenticated;
revoke execute on function public.is_admin(), public.is_member(uuid), public.is_store_owner(uuid) from anon;
