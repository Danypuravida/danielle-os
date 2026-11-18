create table public.os_team_sources (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 source_key text not null,
 title text not null check (length(title) between 1 and 300),
 source_url text,
 kind text not null check (kind in ('document','transcript','script_export')),
 person_key text not null default 'team',
 recorded_on date,
 content text not null default '' check (length(content)<=1000000),
 content_hash text not null default '',
 analysis_status text not null default 'pending' check (analysis_status in ('pending','read','error')),
 metadata jsonb not null default '{}'::jsonb,
 archived_at timestamptz,
 revision bigint not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,source_key)
);
create table public.os_team_briefs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 person_key text not null default 'team',
 kind text not null check (kind in ('one_on_one','cafe','action_plan')),
 source_signature text not null,
 body jsonb not null check (jsonb_typeof(body)='object'),
 reviewed_at timestamptz,
 review_notes text not null default '',
 created_at timestamptz not null default now(),
 unique(user_id,person_key,kind,source_signature)
);
create index os_team_briefs_recent on public.os_team_briefs(user_id,kind,person_key,created_at desc);
create table public.os_team_sync_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 settings jsonb not null default '{}'::jsonb,
 automation_id text,
 last_checked_at timestamptz,
 last_success_at timestamptz,
 last_error text,
 last_signature text,
 updated_at timestamptz not null default now()
);
alter table public.os_team_sources enable row level security;
alter table public.os_team_briefs enable row level security;
alter table public.os_team_sync_state enable row level security;
create policy team_sources_owner on public.os_team_sources for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy team_briefs_owner on public.os_team_briefs for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy team_sync_owner on public.os_team_sync_state for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.os_team_sources,public.os_team_briefs,public.os_team_sync_state from anon;
grant select,insert,update on public.os_team_sources to authenticated;
grant select,update on public.os_team_briefs to authenticated;
grant select on public.os_team_sync_state to authenticated;
grant all on public.os_team_sources,public.os_team_briefs,public.os_team_sync_state to service_role;
create function public.os_team_source_stamp() returns trigger language plpgsql security invoker set search_path=public as $fn$
begin
 new.content_hash=md5(new.content);
 new.updated_at=now();
 if tg_op='UPDATE' then new.revision=old.revision+1; end if;
 return new;
end;$fn$;
revoke all on function public.os_team_source_stamp() from public;
create trigger os_team_source_stamp before insert or update on public.os_team_sources for each row execute function public.os_team_source_stamp();
create function public.os_team_merge_forms(p_owner uuid,p_source jsonb,p_responses jsonb) returns jsonb language plpgsql security invoker set search_path=public as $fn$
declare
 w jsonb; forms jsonb; rows jsonb; incoming jsonb; previous jsonb; merged jsonb; history jsonb; position integer; added integer=0; changed integer=0; key text;
begin
 if current_user not in ('postgres','service_role') then raise exception 'BACKGROUND_SYNC_ONLY' using errcode='42501'; end if;
 if jsonb_typeof(p_responses)<>'array' or jsonb_array_length(p_responses)>5000 then raise exception 'INVALID_RESPONSES'; end if;
 select state into w from public.development_workspaces where user_id=p_owner for update;
 if not found then raise exception 'WORKSPACE_NOT_FOUND'; end if;
 forms=coalesce(w->'formsOneOnOne','{}'::jsonb); rows=coalesce(forms->'responses','[]'::jsonb);
 for incoming in select value from jsonb_array_elements(p_responses) loop
  key=incoming->>'sourceKey';
  if coalesce(key,'')='' or jsonb_typeof(incoming->'answers')<>'array' then raise exception 'INVALID_RESPONSE'; end if;
  select ordinality::integer-1,value into position,previous from jsonb_array_elements(rows) with ordinality where value->>'sourceKey'=key limit 1;
  if found then
   history=coalesce(previous->'history','[]'::jsonb);
   if previous->'answers' is distinct from incoming->'answers' then
    history=history||jsonb_build_array(jsonb_build_object('answers',previous->'answers','archivedAt',now()));
    changed=changed+1;
   end if;
   merged=previous||(incoming-'id'-'preparation'-'history'-'importedAt')||jsonb_build_object('id',previous->>'id','history',history,'lastImportedAt',now());
   if previous->'answers' is distinct from incoming->'answers' then merged=merged||'{"preparationStale":true}'::jsonb; end if;
   rows=jsonb_set(rows,array[position::text],merged);
  else
   rows=rows||jsonb_build_array(incoming||jsonb_build_object('id','forms1on1-'||md5(key),'importedAt',now(),'history','[]'::jsonb));
   added=added+1;
  end if;
 end loop;
 forms=forms||p_source||jsonb_build_object('responses',rows,'lastCheckedAt',now(),'frequency','hourly');
 update public.development_workspaces set state=jsonb_set(w,'{formsOneOnOne}',forms),revision=revision+1,updated_at=now() where user_id=p_owner;
 return jsonb_build_object('added',added,'changed',changed,'total',jsonb_array_length(rows));
end;$fn$;
revoke all on function public.os_team_merge_forms(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.os_team_merge_forms(uuid,jsonb,jsonb) to service_role;
