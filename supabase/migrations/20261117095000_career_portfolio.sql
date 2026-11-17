-- Additive portfolio metadata; existing seniority evidence and RLS are retained.
alter table public.seniority_evidence
  add column if not exists title text,
  add column if not exists entry_type text check (entry_type in ('delivery','project','feedback','course','talk','material')),
  add column if not exists featured boolean not null default false;

create index if not exists seniority_evidence_owner_date_idx
  on public.seniority_evidence (user_id, evidence_date desc, id);

create table if not exists public.career_portfolio_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  evidence_id uuid not null references public.seniority_evidence(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size between 1 and 20971520),
  created_at timestamptz not null default now(),
  constraint career_asset_owner_path check (split_part(storage_path, '/', 1) = user_id::text
    and split_part(storage_path, '/', 2) = evidence_id::text)
);
create index if not exists career_assets_owner_evidence_idx
  on public.career_portfolio_assets (user_id, evidence_id);
alter table public.career_portfolio_assets enable row level security;
create policy career_assets_owner_read on public.career_portfolio_assets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy career_assets_owner_insert on public.career_portfolio_assets for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.seniority_evidence e where e.id = evidence_id and e.user_id = (select auth.uid())
  ));
create policy career_assets_owner_delete on public.career_portfolio_assets for delete to authenticated
  using ((select auth.uid()) = user_id);
grant select, insert, delete on public.career_portfolio_assets to authenticated;
revoke all on public.career_portfolio_assets from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('career-portfolio', 'career-portfolio', false, 20971520, array[
 'image/jpeg','image/png','image/webp','application/pdf',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv'
]) on conflict (id) do nothing;

create policy career_files_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'career-portfolio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy career_files_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'career-portfolio' and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.seniority_evidence e
      where e.id::text = (storage.foldername(name))[2] and e.user_id = (select auth.uid())));
create policy career_files_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'career-portfolio' and (storage.foldername(name))[1] = (select auth.uid())::text);
