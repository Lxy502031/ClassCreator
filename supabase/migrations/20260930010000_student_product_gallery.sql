create table public.gallery_products (
  id uuid primary key default gen_random_uuid(),
  product_type text not null check (product_type in ('teacher', 'student')),
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null check (length(trim(author_name)) between 1 and 60),
  description text not null check (length(trim(description)) between 1 and 500),
  image_path text not null unique,
  image_url text not null,
  created_at timestamptz not null default now()
);
create index gallery_products_publication_idx
  on public.gallery_products (product_type, created_at desc);

alter table public.gallery_products enable row level security;
revoke all on public.gallery_products from public, anon, authenticated;
grant select (id, product_type, author_name, description, image_path, image_url, created_at)
  on public.gallery_products to anon, authenticated;
grant insert (product_type, author_id, author_name, description, image_path, image_url)
  on public.gallery_products to authenticated;
grant delete on public.gallery_products to authenticated;

create policy "Anyone can view published gallery products"
  on public.gallery_products for select
  to anon, authenticated
  using (true);

create policy "Studio administrators can publish teacher products"
  on public.gallery_products for insert
  to authenticated
  with check (
    public.is_store_admin()
    and product_type = 'teacher'
    and author_id = (select auth.uid())
    and image_path like 'teacher/' || (select auth.uid())::text || '/%'
  );

create policy "Studio administrators can remove gallery products"
  on public.gallery_products for delete
  to authenticated
  using (public.is_store_admin());

create table public.gallery_ai_checks (
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index gallery_ai_checks_user_created_idx
  on public.gallery_ai_checks (user_id, created_at desc);

alter table public.gallery_ai_checks enable row level security;
revoke all on public.gallery_ai_checks from public, anon, authenticated;
grant all on public.gallery_ai_checks to service_role;

create or replace function public.reserve_gallery_ai_check()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_check_count integer;
begin
  if v_user_id is null then
    raise exception 'Sign in before checking a gallery product';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  delete from public.gallery_ai_checks
  where user_id = v_user_id
    and created_at <= now() - interval '24 hours';
  select count(*)::integer into v_check_count
  from public.gallery_ai_checks
  where user_id = v_user_id
    and created_at > now() - interval '24 hours';

  if v_check_count >= 10 then
    return false;
  end if;

  insert into public.gallery_ai_checks (user_id) values (v_user_id);
  return true;
end;
$$;

revoke all on function public.reserve_gallery_ai_check() from public, anon;
grant execute on function public.reserve_gallery_ai_check() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery-products', 'gallery-products', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Anyone can view published gallery product images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'gallery-products');

create policy "Studio administrators can upload teacher gallery images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'gallery-products'
    and public.is_store_admin()
    and (storage.foldername(name))[1] = 'teacher'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy "Studio administrators can remove teacher gallery images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'gallery-products'
    and public.is_store_admin()
    and (storage.foldername(name))[1] = 'teacher'
  );
