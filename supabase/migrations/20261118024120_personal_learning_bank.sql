create table public.os_learning_entries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(trim(title)) between 1 and 200),
 topic text not null check (char_length(trim(topic)) between 1 and 80),
 source_type text not null default 'other' check (source_type in ('course','book','podcast','talk','article','other')),
 source_name text not null default '' check (char_length(source_name)<=300),
 source_url text not null default '' check (source_url='' or source_url ~ '^https?://'),
 idea text not null check (char_length(trim(idea)) between 1 and 10000),
 application text not null default '' check (char_length(application)<=10000),
 learned_on date not null default current_date,
 applied_at timestamptz,
 application_notes text not null default '' check (char_length(application_notes)<=10000),
 reviewed_at timestamptz,
 archived_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index os_learning_entries_owner on public.os_learning_entries(user_id,id);
create table public.os_learning_weekly_reviews (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 week_start date not null check (extract(isodow from week_start)=1),
 reflection text not null default '' check (char_length(reflection)<=10000),
 next_action text not null default '' check (char_length(next_action)<=10000),
 reviewed_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,week_start)
);
alter table public.os_learning_entries enable row level security;
alter table public.os_learning_weekly_reviews enable row level security;
create policy learning_entries_owner on public.os_learning_entries for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy learning_reviews_owner on public.os_learning_weekly_reviews for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.os_learning_entries,public.os_learning_weekly_reviews from anon;
grant select,insert,update on public.os_learning_entries,public.os_learning_weekly_reviews to authenticated;
