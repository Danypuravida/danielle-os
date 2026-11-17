create table public.os_task_lists (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 100),
 archived_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,id)
);
create unique index os_task_lists_owner_name on public.os_task_lists(user_id,lower(trim(name))) where archived_at is null;
create table public.os_tasks (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 list_id uuid,
 content text not null check (length(trim(content)) between 1 and 500),
 description text not null default '',
 due_date date,
 priority smallint not null default 1 check (priority between 1 and 4),
 status text not null default 'open' check (status in ('open','completed')),
 completed_at timestamptz,
 archived_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(user_id,list_id) references public.os_task_lists(user_id,id),
 check ((status='completed') = (completed_at is not null))
);
create index os_tasks_owner_status_due on public.os_tasks(user_id,status,due_date) where archived_at is null;
create index os_tasks_owner_list on public.os_tasks(user_id,list_id);
alter table public.os_task_lists enable row level security;
alter table public.os_tasks enable row level security;
create policy os_task_lists_owner on public.os_task_lists for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy os_tasks_owner on public.os_tasks for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update on public.os_task_lists,public.os_tasks to authenticated;
revoke all on public.os_task_lists,public.os_tasks from anon;

-- Keep earlier external planning records as history, without importing them into
-- the new native planner. New plans explicitly identify their native source.
alter table public.focus_task_plans add column task_source text not null default 'todoist'
 check (task_source in ('todoist','native'));
alter table public.focus_task_plans alter column task_source set default 'native';
