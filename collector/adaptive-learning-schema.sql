-- Apply once in the Supabase SQL editor before starting the adaptive worker.
-- Existing collector/history/T7 tables and policies are not modified.
create table if not exists public.wingo_adaptive_checkpoints (
  game_code text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.wingo_adaptive_checkpoints enable row level security;
revoke all on public.wingo_adaptive_checkpoints from anon, authenticated;
grant select, insert, update on public.wingo_adaptive_checkpoints to service_role;
