-- Emails that become Super Admin once their owner signs up AND confirms the email (so no one else can claim it).
-- Applied as migration hub_admin_on_confirmed_signup. The real email is set in the database only, not in this file.
create table if not exists private.admin_emails (email text primary key check (email = lower(email)));
revoke all on private.admin_emails from public, anon, authenticated;
-- insert into private.admin_emails(email) values ('<owner email, lowercase>') on conflict do nothing;

create or replace function private.grant_admin_on_confirm() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and exists (select 1 from private.admin_emails e where e.email = lower(new.email)) then
    insert into public.admins(user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke execute on function private.grant_admin_on_confirm() from public, anon, authenticated;

drop trigger if exists grant_admin_on_confirm on auth.users;
create trigger grant_admin_on_confirm after insert or update of email_confirmed_at on auth.users
  for each row execute function private.grant_admin_on_confirm();

insert into public.admins(user_id)
  select u.id from auth.users u join private.admin_emails e on e.email = lower(u.email)
  where u.email_confirmed_at is not null on conflict do nothing;
