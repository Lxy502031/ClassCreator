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
