create table public.lesson_admins (
  email text primary key
    check (
      email = lower(trim(email))
      and length(email) between 3 and 320
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  is_bootstrap boolean not null default false,
  created_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null,
  constraint lesson_admins_single_bootstrap check (not is_bootstrap or email = 'limxinyang12345@gmail.com')
);

create unique index lesson_admins_one_bootstrap_idx
  on public.lesson_admins (is_bootstrap)
  where is_bootstrap;

insert into public.lesson_admins (email, is_bootstrap)
values ('limxinyang12345@gmail.com', true)
on conflict (email) do update set is_bootstrap = true;

alter table public.lesson_admins enable row level security;
revoke all on public.lesson_admins from public, anon, authenticated;
grant select on public.lesson_admins to authenticated;
grant all on public.lesson_admins to service_role;

create policy "Admins can read lesson administrators"
  on public.lesson_admins for select
  to authenticated
  using (public.is_store_admin());

create or replace function public.is_store_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from auth.users u
      join public.lesson_admins admin on admin.email = lower(u.email)
      where u.id = (select auth.uid())
        and u.email_confirmed_at is not null
        and (
          not admin.is_bootstrap
          or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin'
        )
    );
$$;

revoke all on function public.is_store_admin() from public, anon;
grant execute on function public.is_store_admin() to authenticated, service_role;

create or replace function public.admin_add_lesson_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_store_admin() then
    raise exception 'Administrator access required';
  end if;
  if length(v_email) not between 3 and 320
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid administrator email address';
  end if;
  if not exists (
    select 1
    from auth.users u
    where lower(u.email) = v_email
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Create and verify this user account in Supabase before granting studio access';
  end if;
  if exists (select 1 from public.lesson_admins admin where admin.email = v_email) then
    raise exception 'This email already has studio administrator access';
  end if;

  insert into public.lesson_admins (email, added_by)
  values (v_email, (select auth.uid()));
end;
$$;

create or replace function public.admin_remove_lesson_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_store_admin() then
    raise exception 'Administrator access required';
  end if;

  delete from public.lesson_admins admin
  where admin.email = v_email
    and not admin.is_bootstrap;
  if not found then
    raise exception 'Administrator not found or primary administrator access cannot be removed';
  end if;
end;
$$;

revoke all on function public.admin_add_lesson_admin(text) from public;
revoke all on function public.admin_remove_lesson_admin(text) from public;
grant execute on function public.admin_add_lesson_admin(text) to authenticated;
grant execute on function public.admin_remove_lesson_admin(text) to authenticated;
