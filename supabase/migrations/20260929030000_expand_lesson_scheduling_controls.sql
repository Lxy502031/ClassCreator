alter table public.lesson_settings
  add column capacity integer not null default 1
    check (capacity between 1 and 50);

create table public.lesson_date_overrides (
  session_date date primary key,
  is_open boolean not null default true,
  start_time time not null default '13:00',
  end_time time not null default '15:00',
  duration_minutes integer not null default 60
    check (duration_minutes between 15 and 240),
  capacity integer not null default 1
    check (capacity between 1 and 50),
  updated_at timestamptz not null default now(),
  constraint lesson_date_overrides_time_window_check check (start_time < end_time)
);

alter table public.lesson_date_overrides enable row level security;
revoke all on public.lesson_date_overrides from public, anon, authenticated;
grant select, insert, update, delete on public.lesson_date_overrides to authenticated;
grant all on public.lesson_date_overrides to service_role;

create policy "Admins can manage lesson date overrides"
  on public.lesson_date_overrides for all
  to authenticated
  using (public.is_store_admin())
  with check (public.is_store_admin());

drop index public.lesson_bookings_one_active_student_per_slot_idx;

drop function public.get_lesson_available_slots(date, date);

create function public.get_lesson_available_slots(
  p_start_date date,
  p_end_date date
)
returns table (
  slot_start timestamptz,
  spots_remaining integer
)
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
    with schedule_days as (
      select
        day_value.day_start::date as local_date,
        (day_value.day_start + coalesce(override.start_time, v_settings.start_time)) as local_start,
        (day_value.day_start + coalesce(override.end_time, v_settings.end_time)) as local_end,
        coalesce(override.duration_minutes, v_settings.duration_minutes) as slot_duration,
        coalesce(override.capacity, v_settings.capacity) as slot_capacity,
        case
          when override.session_date is not null then override.is_open
          else extract(dow from day_value.day_start)::smallint = any(v_settings.weekdays)
        end as day_is_open
      from generate_series(
        greatest(p_start_date, v_today)::timestamp,
        least(p_end_date, v_last_date)::timestamp,
        interval '1 day'
      ) as day_value(day_start)
      left join public.lesson_date_overrides override
        on override.session_date = day_value.day_start::date
    ),
    candidates as (
      select
        schedule.local_date,
        candidate.local_start,
        schedule.slot_duration,
        schedule.slot_capacity
      from schedule_days schedule
      cross join lateral generate_series(
        schedule.local_start,
        schedule.local_end - make_interval(mins => schedule.slot_duration),
        make_interval(mins => schedule.slot_duration)
      ) as candidate(local_start)
      where schedule.day_is_open
    )
    select
      (candidate.local_start at time zone 'Asia/Singapore') as slot_start,
      candidate.slot_capacity - (
        select count(*)::integer
        from public.lesson_bookings booking
        where booking.status = 'booked'
          and booking.slot_start = (candidate.local_start at time zone 'Asia/Singapore')
      ) as spots_remaining
    from candidates candidate
    where candidate.local_start at time zone 'Asia/Singapore' > now()
      and candidate.slot_capacity > (
        select count(*)
        from public.lesson_bookings booking
        where booking.status = 'booked'
          and booking.slot_start = (candidate.local_start at time zone 'Asia/Singapore')
      )
      and not exists (
        select 1
        from public.lesson_bookings booking
        where booking.status = 'booked'
          and booking.slot_start <> (candidate.local_start at time zone 'Asia/Singapore')
          and booking.slot_start < (candidate.local_start at time zone 'Asia/Singapore')
              + make_interval(mins => candidate.slot_duration)
          and booking.slot_start + make_interval(mins => booking.duration_minutes)
              > candidate.local_start at time zone 'Asia/Singapore'
      )
    order by candidate.local_start;
end;
$$;

revoke all on function public.get_lesson_available_slots(date, date) from public;
grant execute on function public.get_lesson_available_slots(date, date) to anon, authenticated;

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
#variable_conflict use_column
declare
  v_settings public.lesson_settings%rowtype;
  v_override public.lesson_date_overrides%rowtype;
  v_local_start timestamp;
  v_today date := (now() at time zone 'Asia/Singapore')::date;
  v_start_time time;
  v_end_time time;
  v_duration integer;
  v_capacity integer;
  v_day_open boolean;
  v_booking_count integer;
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

  select * into v_override
    from public.lesson_date_overrides
    where session_date = v_local_start::date
    for share;
  if found then
    v_day_open := v_override.is_open;
    v_start_time := v_override.start_time;
    v_end_time := v_override.end_time;
    v_duration := v_override.duration_minutes;
    v_capacity := v_override.capacity;
  else
    v_day_open := extract(dow from v_local_start)::smallint = any(v_settings.weekdays);
    v_start_time := v_settings.start_time;
    v_end_time := v_settings.end_time;
    v_duration := v_settings.duration_minutes;
    v_capacity := v_settings.capacity;
  end if;

  if p_slot_start <= now()
    or v_local_start::date < v_today
    or v_local_start::date > v_today + v_settings.booking_horizon_days
    or not v_day_open
    or v_local_start::time < v_start_time
    or v_local_start::time + make_interval(mins => v_duration) > v_end_time
    or mod(
      extract(epoch from (v_local_start::time - v_start_time))::integer / 60,
      v_duration
    ) <> 0 then
    raise exception 'That lesson time is no longer available';
  end if;
  if exists (
    select 1 from public.lesson_bookings booking
    where booking.status = 'booked'
      and booking.slot_start <> p_slot_start
      and booking.slot_start < p_slot_start + make_interval(mins => v_duration)
      and booking.slot_start + make_interval(mins => booking.duration_minutes) > p_slot_start
  ) then
    raise exception 'That lesson time overlaps with a booking. Please choose another available time';
  end if;

  select count(*)::integer into v_booking_count
    from public.lesson_bookings booking
    where booking.status = 'booked' and booking.slot_start = p_slot_start;
  if v_booking_count >= v_capacity then
    raise exception 'That lesson session is full. Please choose another available time';
  end if;

  insert into public.lesson_bookings (
    request_id, student_name, email, phone, slot_start, duration_minutes
  )
  values (
    p_request_id, trim(p_student_name), lower(trim(p_email)), trim(p_phone),
    p_slot_start, v_duration
  )
  returning id into v_booking_id;

  return query select v_booking_id, v_settings.class_title, p_slot_start,
      v_duration, false, 'pending'::text;
end;
$$;

revoke all on function public.create_lesson_booking(text, text, text, timestamptz, uuid) from public;
grant execute on function public.create_lesson_booking(text, text, text, timestamptz, uuid) to service_role;

create or replace function public.admin_update_lesson_booking(
  p_booking_id uuid,
  p_student_name text,
  p_email text,
  p_phone text,
  p_slot_start timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.lesson_settings%rowtype;
  v_override public.lesson_date_overrides%rowtype;
  v_booking public.lesson_bookings%rowtype;
  v_local_start timestamp;
  v_start_time time;
  v_end_time time;
  v_duration integer;
  v_capacity integer;
  v_day_open boolean;
  v_booking_count integer;
  v_today date := (now() at time zone 'Asia/Singapore')::date;
begin
  if not public.is_store_admin() then
    raise exception 'Administrator access required';
  end if;
  if p_booking_id is null
    or p_slot_start is null
    or p_student_name is null or length(trim(p_student_name)) not between 1 and 100
    or p_email is null or length(trim(p_email)) not between 3 and 320
    or trim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_phone is null or length(trim(p_phone)) not between 8 and 24
    or trim(p_phone) !~ '^\+?[0-9][0-9 ()-]{6,22}$' then
    raise exception 'Enter valid student details and choose a lesson time';
  end if;

  select * into v_booking
    from public.lesson_bookings
    where id = p_booking_id and status = 'booked'
    for update;
  if not found then
    raise exception 'This booking is no longer active';
  end if;
  select * into v_settings from public.lesson_settings where id = true for share;
  if not found or not v_settings.is_active then
    raise exception 'Lesson bookings are not available right now';
  end if;

  v_local_start := p_slot_start at time zone 'Asia/Singapore';
  perform pg_advisory_xact_lock(hashtextextended('lesson:' || v_local_start::date::text, 0));
  select * into v_override
    from public.lesson_date_overrides
    where session_date = v_local_start::date
    for share;
  if found then
    v_day_open := v_override.is_open;
    v_start_time := v_override.start_time;
    v_end_time := v_override.end_time;
    v_duration := v_override.duration_minutes;
    v_capacity := v_override.capacity;
  else
    v_day_open := extract(dow from v_local_start)::smallint = any(v_settings.weekdays);
    v_start_time := v_settings.start_time;
    v_end_time := v_settings.end_time;
    v_duration := v_settings.duration_minutes;
    v_capacity := v_settings.capacity;
  end if;

  if p_slot_start <= now()
    or v_local_start::date < v_today
    or v_local_start::date > v_today + v_settings.booking_horizon_days
    or not v_day_open
    or v_local_start::time < v_start_time
    or v_local_start::time + make_interval(mins => v_duration) > v_end_time
    or mod(
      extract(epoch from (v_local_start::time - v_start_time))::integer / 60,
      v_duration
    ) <> 0 then
    raise exception 'That lesson time is not an available session';
  end if;

  if exists (
    select 1 from public.lesson_bookings booking
    where booking.status = 'booked'
      and booking.id <> p_booking_id
      and booking.slot_start <> p_slot_start
      and booking.slot_start < p_slot_start + make_interval(mins => v_duration)
      and booking.slot_start + make_interval(mins => booking.duration_minutes) > p_slot_start
  ) then
    raise exception 'That lesson time overlaps another session';
  end if;

  select count(*)::integer into v_booking_count
    from public.lesson_bookings booking
    where booking.status = 'booked'
      and booking.slot_start = p_slot_start
      and booking.id <> p_booking_id;
  if v_booking_count >= v_capacity then
    raise exception 'That lesson session is full';
  end if;

  update public.lesson_bookings
    set student_name = trim(p_student_name),
        email = lower(trim(p_email)),
        phone = trim(p_phone),
        slot_start = p_slot_start,
        duration_minutes = v_duration
    where id = p_booking_id;
end;
$$;

revoke all on function public.admin_update_lesson_booking(uuid, text, text, text, timestamptz) from public;
grant execute on function public.admin_update_lesson_booking(uuid, text, text, text, timestamptz) to authenticated;
