alter table public.assistant_items add column if not exists hidden_at timestamptz, add column if not exists hidden_reason text;
comment on column public.assistant_items.hidden_at is 'Archived duplicate or suppressed source; record retained for reversible cleanup.';
