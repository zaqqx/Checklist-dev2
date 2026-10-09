-- À exécuter dans Supabase → SQL Editor.
-- Tout le fichier est idempotent : il peut être ré-exécuté en entier sans risque.

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

create table if not exists "TaskComment" (
  id text primary key,
  "taskId" text not null references "Task" (id) on delete cascade,
  author text not null,
  body text not null check (char_length(body) between 1 and 2000),
  "createdAt" timestamptz not null default now()
);

-- MIGRATIONS : colonnes ajoutées après la création des tables
alter table "Task" add column if not exists notes text;

-- INDEX : colonnes utilisées pour filtrer et trier les tâches
create index if not exists "Task_status_idx" on "Task" (status);
create index if not exists "Task_deadline_idx" on "Task" (deadline);
create index if not exists "Task_assignedTo_idx" on "Task" ("assignedTo");
create index if not exists "TaskComment_taskId_idx" on "TaskComment" ("taskId");

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
alter table "TaskComment" enable row level security;

-- POLICIES : accès réservé aux utilisateurs connectés (Supabase Auth)
drop policy if exists "task_auth_all" on "Task";
create policy "task_auth_all" on "Task"
  for all to authenticated using (true) with check (true);

drop policy if exists "dev_auth_all" on "Dev";
create policy "dev_auth_all" on "Dev"
  for all to authenticated using (true) with check (true);

drop policy if exists "task_comment_auth_all" on "TaskComment";
create policy "task_comment_auth_all" on "TaskComment"
  for all to authenticated using (true) with check (true);

-- Recharge le cache de schéma de l'API (nouvelles colonnes et relation TaskComment → Task).
notify pgrst, 'reload schema';
