create table public.lesson_settings (
  id boolean primary key default true check (id),
  class_title text not null default 'Handmade craft lesson'
    check (length(trim(class_title)) between 1 and 120),
  description text not null default 'Join us for a relaxed, hands-on creative session. Choose a time that works for you and reserve your place.'
    check (length(trim(description)) between 1 and 2000),
  weekdays smallint[] not null default array[0, 3, 6]::smallint[]
    check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  start_time time not null default '13:00',
  end_time time not null default '15:00',
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 240),
  booking_horizon_days integer not null default 60 check (booking_horizon_days between 7 and 180),
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint lesson_settings_time_window_check check (start_time < end_time)
);

insert into public.lesson_settings (id) values (true);

create table public.lesson_bookings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  student_name text not null check (length(trim(student_name)) between 1 and 100),
  email text not null check (length(trim(email)) between 3 and 320),
  phone text not null check (length(trim(phone)) between 8 and 24),
  slot_start timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 15 and 240),
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now()
);

create unique index lesson_bookings_one_active_student_per_slot_idx
  on public.lesson_bookings (slot_start)
  where status = 'booked';

create index lesson_bookings_created_at_idx
  on public.lesson_bookings (created_at desc);

alter table public.lesson_settings enable row level security;
alter table public.lesson_bookings enable row level security;

revoke all on public.lesson_settings, public.lesson_bookings from public, anon, authenticated;
grant select on public.lesson_settings to anon, authenticated;
grant insert, update, delete on public.lesson_settings to authenticated;
grant select, update on public.lesson_bookings to authenticated;
grant all on public.lesson_settings, public.lesson_bookings to service_role;

create policy "Public can read lesson settings"
  on public.lesson_settings for select
  to anon, authenticated
  using (true);

create policy "Admins can manage lesson settings"
  on public.lesson_settings for all
  to authenticated
  using (public.is_store_admin())
  with check (public.is_store_admin());

create policy "Admins can read lesson bookings"
  on public.lesson_bookings for select
  to authenticated
  using (public.is_store_admin());

create policy "Admins can update lesson bookings"
  on public.lesson_bookings for update
  to authenticated
  using (public.is_store_admin())
  with check (public.is_store_admin());

create or replace function public.get_lesson_available_slots(
  p_start_date date,
  p_end_date date
)
returns table (slot_start timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.lesson_settings%rowtype;
  v_today date := (now() at time zone 'Asia/Singapore')::date;
  v_last_date date;
begin
  if p_start_date is null or p_end_date is null
    or p_end_date < p_start_date
    or p_end_date - p_start_date > 62 then
    raise exception 'Choose a valid date range of no more than 63 days';
  end if;

  select * into v_settings from public.lesson_settings where id = true;
  if not found or not v_settings.is_active then
    return;
  end if;
  v_last_date := v_today + v_settings.booking_horizon_days;

  return query
    select (candidate.local_start at time zone 'Asia/Singapore') as slot_start
    from generate_series(
      greatest(p_start_date, v_today)::timestamp,
      least(p_end_date, v_last_date)::timestamp,
      interval '1 day'
    ) as day_value(day_start)
    cross join lateral generate_series(
      day_value.day_start + v_settings.start_time,
      day_value.day_start + v_settings.end_time - make_interval(mins => v_settings.duration_minutes),
      make_interval(mins => v_settings.duration_minutes)
    ) as candidate(local_start)
    where extract(dow from day_value.day_start)::smallint = any(v_settings.weekdays)
      and candidate.local_start at time zone 'Asia/Singapore' > now()
      and not exists (
        select 1 from public.lesson_bookings booking
        where booking.status = 'booked'
          and booking.slot_start < (candidate.local_start at time zone 'Asia/Singapore')
              + make_interval(mins => v_settings.duration_minutes)
          and booking.slot_start + make_interval(mins => booking.duration_minutes)
              > candidate.local_start at time zone 'Asia/Singapore'
      )
    order by candidate.local_start;
end;
$$;

create or replace function public.create_lesson_booking(
  p_student_name text,
  p_email text,
  p_phone text,
  p_slot_start timestamptz,
  p_request_id uuid
)
returns table (
  booking_id uuid,
  class_title text,
  slot_start timestamptz,
  duration_minutes integer,
  already_booked boolean,
  email_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.lesson_settings%rowtype;
  v_local_start timestamp;
  v_today date := (now() at time zone 'Asia/Singapore')::date;
  v_booking_id uuid;
  v_recent_bookings integer;
begin
  if p_student_name is null or length(trim(p_student_name)) not between 1 and 100
    or p_email is null or length(trim(p_email)) not between 3 and 320
    or trim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_phone is null or length(trim(p_phone)) not between 8 and 24
    or trim(p_phone) !~ '^\+?[0-9][0-9 ()-]{6,22}$'
    or p_slot_start is null
    or p_request_id is null then
    raise exception 'Enter a valid name, email, phone number, and lesson time';
  end if;

  select * into v_settings from public.lesson_settings where id = true for share;
  if not found or not v_settings.is_active then
    raise exception 'Lesson bookings are not available right now';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)), 0));
  if exists (
    select 1 from public.lesson_bookings
    where request_id = p_request_id and email <> lower(trim(p_email))
  ) then
    raise exception 'This booking request is invalid';
  end if;
  return query
    select booking.id, v_settings.class_title, booking.slot_start,
        booking.duration_minutes, true, booking.email_status
      from public.lesson_bookings booking
      where booking.request_id = p_request_id
        and booking.email = lower(trim(p_email))
        and booking.status = 'booked';
  if found then
    return;
  end if;
  if exists (
    select 1 from public.lesson_bookings
    where request_id = p_request_id and email = lower(trim(p_email))
  ) then
    raise exception 'That booking request was cancelled. Please choose a new time';
  end if;

  select count(*)::integer into v_recent_bookings
    from public.lesson_bookings
    where email = lower(trim(p_email))
      and created_at >= now() - interval '24 hours';
  if v_recent_bookings >= 3 then
    raise exception 'You have reached the daily booking limit. Please contact us if you need help';
  end if;

  v_local_start := p_slot_start at time zone 'Asia/Singapore';
  perform pg_advisory_xact_lock(hashtextextended('lesson:' || v_local_start::date::text, 0));
  if p_slot_start <= now()
    or v_local_start::date < v_today
    or v_local_start::date > v_today + v_settings.booking_horizon_days
    or extract(dow from v_local_start)::smallint <> all(v_settings.weekdays)
    or v_local_start::time < v_settings.start_time
    or v_local_start::time + make_interval(mins => v_settings.duration_minutes) > v_settings.end_time
    or mod(
      extract(epoch from (v_local_start::time - v_settings.start_time))::integer / 60,
      v_settings.duration_minutes
    ) <> 0 then
    raise exception 'That lesson time is no longer available';
  end if;
  if exists (
    select 1 from public.lesson_bookings booking
    where booking.status = 'booked'
      and booking.slot_start < p_slot_start + make_interval(mins => v_settings.duration_minutes)
      and booking.slot_start + make_interval(mins => booking.duration_minutes) > p_slot_start
  ) then
    raise exception 'That lesson time overlaps with a booking. Please choose another available time';
  end if;

  insert into public.lesson_bookings (
    request_id, student_name, email, phone, slot_start, duration_minutes
  )
  values (
    p_request_id, trim(p_student_name), lower(trim(p_email)), trim(p_phone),
    p_slot_start, v_settings.duration_minutes
  )
  on conflict (slot_start) where status = 'booked' do nothing
  returning id into v_booking_id;

  if v_booking_id is null then
    raise exception 'That lesson time was just booked. Please choose another available time';
  end if;

  return query select v_booking_id, v_settings.class_title, p_slot_start,
      v_settings.duration_minutes, false, 'pending'::text;
end;
$$;

revoke all on function public.get_lesson_available_slots(date, date) from public;
grant execute on function public.get_lesson_available_slots(date, date) to anon, authenticated;

revoke all on function public.create_lesson_booking(text, text, text, timestamptz, uuid) from public;
grant execute on function public.create_lesson_booking(text, text, text, timestamptz, uuid) to service_role;
