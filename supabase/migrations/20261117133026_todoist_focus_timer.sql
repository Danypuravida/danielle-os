create table public.focus_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 focus_minutes integer not null default 25 check (focus_minutes between 1 and 120),
 break_minutes integer not null default 5 check (break_minutes between 1 and 30),
 daily_goal integer not null default 8 check (daily_goal between 1 and 24),
 updated_at timestamptz not null default now()
);
create table public.focus_task_plans (
 user_id uuid not null references auth.users(id) on delete cascade,
 day date not null,
 task_id text not null,
 task_name text not null,
 estimated_minutes integer check (estimated_minutes between 1 and 1440),
 category text not null default 'other' check (category in ('work','study','personal','other')),
 completed_at timestamptz,
 excluded boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(user_id,day,task_id)
);
create table public.focus_sessions (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 task_id text,
 task_name text not null,
 category text not null default 'other' check (category in ('work','study','personal','other')),
 kind text not null check (kind in ('focus','break')),
 planned_seconds integer not null check (planned_seconds between 60 and 7200),
 status text not null check (status in ('running','paused','completed','stopped')),
 elapsed_seconds numeric not null default 0 check (elapsed_seconds >= 0 and elapsed_seconds <= planned_seconds),
 started_at timestamptz not null default now(),
 last_started_at timestamptz,
 finished_at timestamptz,
 segments jsonb not null default '[]' check (jsonb_typeof(segments) = 'array'),
 revision integer not null default 1,
 last_command_id uuid,
 updated_at timestamptz not null default now(),
 check (kind <> 'focus' or task_id is not null),
 check ((status = 'running') = (last_started_at is not null)),
 check ((status in ('completed','stopped')) = (finished_at is not null))
);
create unique index focus_one_active_per_owner on public.focus_sessions(user_id) where status in ('running','paused');
create index focus_sessions_owner_dates on public.focus_sessions(user_id,started_at desc);
create index focus_sessions_owner_finished on public.focus_sessions(user_id,finished_at);
alter table public.focus_settings enable row level security;
alter table public.focus_task_plans enable row level security;
alter table public.focus_sessions enable row level security;
create policy focus_settings_owner on public.focus_settings for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy focus_plans_owner on public.focus_task_plans for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy focus_sessions_owner on public.focus_sessions for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update on public.focus_settings,public.focus_task_plans,public.focus_sessions to authenticated;
revoke all on public.focus_settings,public.focus_task_plans,public.focus_sessions from anon;

-- The settings row serializes commands from different tabs/devices. Every read/write
-- stays under the caller's RLS; no privileged function or browser secret is needed.
create function public.focus_timer_command(
 p_action text, p_session_id uuid default null, p_revision integer default null,
 p_command_id uuid default null, p_task_id text default null, p_task_name text default null,
 p_category text default 'other', p_kind text default 'focus', p_planned_seconds integer default 1500,
 p_occurred_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 owner uuid := auth.uid(); current_session public.focus_sessions; prefs public.focus_settings;
 server_time timestamptz := clock_timestamp(); effective_time timestamptz;
 segment_end timestamptz; seconds_added numeric; conflict boolean := false;
begin
 if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_action not in ('status','start','pause','resume','stop','settle') then raise exception 'Unknown focus command'; end if;
 insert into public.focus_settings(user_id) values(owner) on conflict(user_id) do nothing;
 select * into prefs from public.focus_settings where user_id=owner for update;
 server_time := clock_timestamp();
 select * into current_session from public.focus_sessions where user_id=owner and status in ('running','paused') for update;
 if p_action='start' and p_session_id is null then raise exception 'A stable session ID is required'; end if;
 -- First confirm an earlier start whose response may have been lost.
 if p_action='start' and not found then
  select * into current_session from public.focus_sessions where id=p_session_id and user_id=owner;
  if found then return jsonb_build_object('session',to_jsonb(current_session),'server_now',server_time,'conflict',false); end if;
 end if;
 if current_session.id is not null then
  if p_action not in ('status','start') and (p_session_id is distinct from current_session.id or (p_revision is not null and p_revision<>current_session.revision and p_command_id is distinct from current_session.last_command_id)) then
   return jsonb_build_object('session',to_jsonb(current_session),'server_now',server_time,'conflict',true);
  end if;
  if p_command_id is not null and current_session.last_command_id=p_command_id then
   return jsonb_build_object('session',to_jsonb(current_session),'server_now',server_time,'conflict',false);
  end if;
  -- A queued pause/stop uses the time it was requested, even after reconnection.
  effective_time := case when p_action in ('pause','stop') and p_occurred_at is not null then least(server_time,greatest(current_session.last_started_at,p_occurred_at)) else server_time end;
  if current_session.status='running' then
   segment_end := least(effective_time,current_session.last_started_at+((current_session.planned_seconds-current_session.elapsed_seconds)*interval '1 second'));
   seconds_added := greatest(0,extract(epoch from segment_end-current_session.last_started_at));
   if p_action in ('pause','stop') or current_session.elapsed_seconds+seconds_added>=current_session.planned_seconds then
    current_session.elapsed_seconds:=least(current_session.planned_seconds,current_session.elapsed_seconds+seconds_added);
    if seconds_added>0 then current_session.segments:=current_session.segments||jsonb_build_array(jsonb_build_object('start',current_session.last_started_at,'end',segment_end)); end if;
    current_session.last_started_at:=null;
    if current_session.elapsed_seconds>=current_session.planned_seconds then current_session.status:='completed';current_session.finished_at:=segment_end;
    elsif p_action='stop' then current_session.status:='stopped';current_session.finished_at:=effective_time;
    else current_session.status:='paused';end if;
    current_session.revision:=current_session.revision+1;
   end if;
  elsif current_session.status='paused' then
   if p_action='resume' then current_session.status:='running';current_session.last_started_at:=server_time;current_session.revision:=current_session.revision+1;
   elsif p_action='stop' then current_session.status:='stopped';current_session.finished_at:=server_time;current_session.revision:=current_session.revision+1;end if;
  end if;
  if p_action not in ('status','start') then current_session.last_command_id:=p_command_id;end if;
  update public.focus_sessions set status=current_session.status,elapsed_seconds=current_session.elapsed_seconds,last_started_at=current_session.last_started_at,finished_at=current_session.finished_at,segments=current_session.segments,revision=current_session.revision,last_command_id=current_session.last_command_id,updated_at=server_time where id=current_session.id and user_id=owner;
 end if;
 if p_action='start' then
  if current_session.id is not null and current_session.status in ('running','paused') then
   return jsonb_build_object('session',to_jsonb(current_session),'server_now',server_time,'conflict',current_session.id<>p_session_id);
  end if;
  -- Starting a new cycle is always an explicit action, never an automatic chain.
  select * into current_session from public.focus_sessions where id=p_session_id and user_id=owner;
  if found then return jsonb_build_object('session',to_jsonb(current_session),'server_now',server_time,'conflict',false);end if;
  if p_kind not in ('focus','break') or p_planned_seconds not between 60 and 7200 or p_category not in ('work','study','personal','other') or (p_kind='focus' and (nullif(p_task_id,'') is null or nullif(trim(p_task_name),'') is null)) then raise exception 'Invalid focus session';end if;
  insert into public.focus_sessions(id,user_id,task_id,task_name,category,kind,planned_seconds,status,last_started_at,last_command_id,started_at)
   values(p_session_id,owner,p_task_id,coalesce(nullif(trim(p_task_name),''),'Pausa'),p_category,p_kind,p_planned_seconds,'running',server_time,p_command_id,server_time) returning * into current_session;
 elsif current_session.id is null and p_session_id is not null then
  select * into current_session from public.focus_sessions where id=p_session_id and user_id=owner;
  if found and p_revision is not null and p_revision<>current_session.revision and p_command_id is distinct from current_session.last_command_id then conflict:=true;end if;
 end if;
 return jsonb_build_object('session',case when current_session.id is null then null else to_jsonb(current_session) end,'server_now',server_time,'conflict',conflict);
end $$;
revoke all on function public.focus_timer_command(text,uuid,integer,uuid,text,text,text,text,integer,timestamptz) from public,anon;
grant execute on function public.focus_timer_command(text,uuid,integer,uuid,text,text,text,text,integer,timestamptz) to authenticated;
