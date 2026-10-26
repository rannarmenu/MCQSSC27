-- SSC 2027 live MCQ progress monitor
-- All objects are namespaced ssc27_*; existing recipe tables are not changed.

create table if not exists public.ssc27_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Bootstrap only already-authorized site admins; no public/self-signup path grants admin access.
insert into public.ssc27_admins (user_id)
select user_id from public.admin_users
on conflict (user_id) do nothing;

create table if not exists public.ssc27_sessions (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text not null unique,
  student_name text not null check (char_length(student_name) between 2 and 80),
  city text not null check (char_length(city) between 2 and 80),
  status text not null default 'ready' check (status in ('ready', 'active', 'left')),
  current_quiz text check (current_quiz is null or char_length(current_quiz) <= 180),
  current_subject text check (current_subject is null or char_length(current_subject) <= 120),
  total_questions integer not null default 0 check (total_questions between 0 and 2000),
  answered_count integer not null default 0 check (answered_count between 0 and 2000),
  correct_count integer not null default 0 check (correct_count between 0 and 2000),
  wrong_count integer not null default 0 check (wrong_count between 0 and 2000),
  current_question_number integer,
  current_question_text text check (current_question_text is null or char_length(current_question_text) <= 1800),
  last_answer text check (last_answer is null or char_length(last_answer) <= 500),
  last_event text not null default 'identity_submitted',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.ssc27_answer_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ssc27_sessions(id) on delete cascade,
  event_type text not null check (event_type in (
    'identity_submitted', 'quiz_opened', 'quiz_started', 'question_viewed',
    'answer_submitted', 'quiz_completed', 'quiz_closed', 'session_left'
  )),
  quiz_title text,
  subject text,
  question_number integer,
  question_text text check (question_text is null or char_length(question_text) <= 1800),
  selected_answer text check (selected_answer is null or char_length(selected_answer) <= 500),
  is_correct boolean,
  event_at timestamptz not null default now()
);

create index if not exists ssc27_sessions_last_seen_idx
  on public.ssc27_sessions (last_seen_at desc);
create index if not exists ssc27_sessions_student_name_idx
  on public.ssc27_sessions (lower(student_name));
create index if not exists ssc27_events_session_time_idx
  on public.ssc27_answer_events (session_id, event_at desc);
create index if not exists ssc27_events_type_time_idx
  on public.ssc27_answer_events (event_type, event_at desc);

alter table public.ssc27_admins enable row level security;
alter table public.ssc27_sessions enable row level security;
alter table public.ssc27_answer_events enable row level security;

drop policy if exists ssc27_admins_select_self on public.ssc27_admins;
create policy ssc27_admins_select_self
  on public.ssc27_admins for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ssc27_admins_read_sessions on public.ssc27_sessions;
create policy ssc27_admins_read_sessions
  on public.ssc27_sessions for select to authenticated
  using (exists (
    select 1 from public.ssc27_admins a
    where a.user_id = (select auth.uid())
  ));

drop policy if exists ssc27_admins_read_events on public.ssc27_answer_events;
create policy ssc27_admins_read_events
  on public.ssc27_answer_events for select to authenticated
  using (exists (
    select 1 from public.ssc27_admins a
    where a.user_id = (select auth.uid())
  ));

-- Public visitors cannot read or write table rows directly. All student writes pass
-- through the token-checked RPCs below; only authenticated admins may SELECT through RLS.
revoke all privileges on table public.ssc27_admins, public.ssc27_sessions, public.ssc27_answer_events
  from public, anon, authenticated;
grant select on table public.ssc27_admins, public.ssc27_sessions, public.ssc27_answer_events
  to authenticated;

create or replace function public.ssc27_start_session(
  p_student_name text,
  p_city text,
  p_session_token text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_token_hash text;
  v_name text;
  v_city text;
begin
  v_name := btrim(coalesce(p_student_name, ''));
  v_city := btrim(coalesce(p_city, ''));

  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'নাম ২ থেকে ৮০ অক্ষরের মধ্যে লিখুন';
  end if;
  if char_length(v_city) < 2 or char_length(v_city) > 80 then
    raise exception 'শহর/জেলা ২ থেকে ৮০ অক্ষরের মধ্যে লিখুন';
  end if;
  if p_session_token is null or char_length(p_session_token) < 32 or char_length(p_session_token) > 128 then
    raise exception 'সেশন টোকেনটি বৈধ নয়';
  end if;

  v_token_hash := encode(extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256'), 'hex');

  insert into public.ssc27_sessions (
    session_token_hash, student_name, city, status, last_event, last_seen_at
  ) values (
    v_token_hash, v_name, v_city, 'ready', 'identity_submitted', now()
  ) returning id into v_id;

  insert into public.ssc27_answer_events (session_id, event_type)
  values (v_id, 'identity_submitted');

  return v_id;
end;
$$;

create or replace function public.ssc27_track_event(
  p_session_id uuid,
  p_session_token text,
  p_event_type text,
  p_quiz_title text,
  p_subject text,
  p_question_number integer,
  p_question_text text,
  p_selected_answer text,
  p_is_correct boolean,
  p_total_questions integer,
  p_answered_count integer,
  p_correct_count integer,
  p_wrong_count integer,
  p_status text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_hash text;
  v_updated_id uuid;
begin
  if p_session_token is null or char_length(p_session_token) < 32 or char_length(p_session_token) > 128 then
    raise exception 'সেশন টোকেনটি বৈধ নয়';
  end if;

  if p_event_type not in (
    'identity_submitted', 'quiz_opened', 'quiz_started', 'question_viewed',
    'answer_submitted', 'quiz_completed', 'quiz_closed', 'heartbeat', 'session_left'
  ) then
    raise exception 'অজানা ট্র্যাকিং ইভেন্ট';
  end if;

  if p_status is not null and p_status not in ('ready', 'active', 'left') then
    raise exception 'অবৈধ সেশন স্ট্যাটাস';
  end if;

  v_token_hash := encode(extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256'), 'hex');

  update public.ssc27_sessions as s
  set
    status = case
      when p_event_type = 'session_left' then 'left'
      when p_status is not null then p_status
      when p_event_type in ('quiz_opened', 'quiz_started', 'question_viewed', 'answer_submitted') then 'active'
      else s.status
    end,
    current_quiz = case
      when p_event_type = 'quiz_closed' then null
      when p_quiz_title is not null then nullif(left(btrim(p_quiz_title), 180), '')
      else s.current_quiz
    end,
    current_subject = case
      when p_event_type = 'quiz_closed' then null
      when p_subject is not null then nullif(left(btrim(p_subject), 120), '')
      else s.current_subject
    end,
    total_questions = case when p_total_questions is null then s.total_questions
      else greatest(0, least(p_total_questions, 2000)) end,
    answered_count = case when p_answered_count is null then s.answered_count
      else greatest(0, least(p_answered_count, 2000)) end,
    correct_count = case when p_correct_count is null then s.correct_count
      else greatest(0, least(p_correct_count, 2000)) end,
    wrong_count = case when p_wrong_count is null then s.wrong_count
      else greatest(0, least(p_wrong_count, 2000)) end,
    current_question_number = case
      when p_event_type in ('quiz_opened', 'quiz_started', 'quiz_closed') then null
      when p_question_number is not null then greatest(1, least(p_question_number, 2000))
      else s.current_question_number
    end,
    current_question_text = case
      when p_event_type in ('quiz_opened', 'quiz_started', 'quiz_closed') then null
      when p_question_text is not null then left(p_question_text, 1800)
      else s.current_question_text
    end,
    last_answer = case
      when p_event_type = 'answer_submitted' then nullif(left(coalesce(p_selected_answer, ''), 500), '')
      when p_event_type = 'quiz_closed' then null
      else s.last_answer
    end,
    last_event = p_event_type,
    last_seen_at = now(),
    started_at = case when p_event_type = 'quiz_started' then coalesce(s.started_at, now()) else s.started_at end,
    ended_at = case when p_event_type = 'session_left' then now()
      when p_event_type in ('quiz_opened', 'quiz_started') then null
      else s.ended_at end
  where s.id = p_session_id
    and s.session_token_hash = v_token_hash
  returning s.id into v_updated_id;

  if v_updated_id is null then
    raise exception 'সেশন পাওয়া যায়নি অথবা টোকেন মেলেনি';
  end if;

  if p_event_type <> 'heartbeat' then
    insert into public.ssc27_answer_events (
      session_id, event_type, quiz_title, subject, question_number,
      question_text, selected_answer, is_correct
    ) values (
      p_session_id, p_event_type,
      nullif(left(btrim(coalesce(p_quiz_title, '')), 180), ''),
      nullif(left(btrim(coalesce(p_subject, '')), 120), ''),
      case when p_question_number is null then null else greatest(1, least(p_question_number, 2000)) end,
      nullif(left(btrim(coalesce(p_question_text, '')), 1800), ''),
      nullif(left(btrim(coalesce(p_selected_answer, '')), 500), ''),
      p_is_correct
    );
  end if;

  return true;
end;
$$;

revoke all on function public.ssc27_start_session(text, text, text) from public, anon, authenticated;
grant execute on function public.ssc27_start_session(text, text, text) to anon, authenticated;

revoke all on function public.ssc27_track_event(uuid, text, text, text, text, integer, text, text, boolean, integer, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.ssc27_track_event(uuid, text, text, text, text, integer, text, text, boolean, integer, integer, integer, integer, text)
  to anon, authenticated;

-- Enable Postgres Changes for live admin updates if the project's standard publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ssc27_sessions'
    ) then
      execute 'alter publication supabase_realtime add table public.ssc27_sessions';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ssc27_answer_events'
    ) then
      execute 'alter publication supabase_realtime add table public.ssc27_answer_events';
    end if;
  end if;
end;
$$;
