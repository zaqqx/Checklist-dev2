-- À exécuter dans Supabase → SQL Editor.
-- Si les tables existent déjà (ancien projet), seules les sections "TRIGGERS" et "POLICIES" sont nécessaires.

do $$ begin
  create type "Urgency" as enum ('BASSE', 'MOYENNE', 'HAUTE', 'CRITIQUE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type "TaskStatus" as enum ('A_FAIRE', 'EN_COURS', 'TERMINE');
exception when duplicate_object then null; end $$;

create table if not exists "Task" (
  id text primary key,
  "cabCode" text,
  "cabLink" text,
  "siteUrl" text,
  "siteName" text,
  description text,
  urgency "Urgency" not null default 'MOYENNE',
  deadline timestamptz,
  status "TaskStatus" not null default 'A_FAIRE',
  "assignedTo" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists "Dev" (
  id text primary key,
  name text not null unique,
  "createdAt" timestamptz not null default now()
);

-- TRIGGERS : met à jour "updatedAt" à chaque modification d'une tâche
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new."updatedAt" = now();
  return new;
end $$;

drop trigger if exists "task_set_updated_at" on "Task";
create trigger "task_set_updated_at"
  before update on "Task"
  for each row execute function set_updated_at();

alter table "Task" enable row level security;
alter table "Dev" enable row level security;

-- POLICIES : accès réservé aux utilisateurs connectés (Supabase Auth)
drop policy if exists "task_auth_all" on "Task";
create policy "task_auth_all" on "Task"
  for all to authenticated using (true) with check (true);

drop policy if exists "dev_auth_all" on "Dev";
create policy "dev_auth_all" on "Dev"
  for all to authenticated using (true) with check (true);
