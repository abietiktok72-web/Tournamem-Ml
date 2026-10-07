-- ML Tournament production auth migration
-- Safe migration: preserves existing teams/matches data.
-- Run AFTER the existing schema.sql has been applied.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role = 'admin'),
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- The frontend only needs to read the current user's own admin row.
drop policy if exists "admin_users_self_read" on public.admin_users;
create policy "admin_users_self_read"
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

-- SECURITY DEFINER avoids recursive RLS checks when this helper is used
-- inside teams/matches/storage policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
      and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- Public can view tournament data. Only admins can mutate it.
alter table public.teams enable row level security;
alter table public.matches enable row level security;

drop policy if exists "teams_public_read" on public.teams;
create policy "teams_public_read" on public.teams
for select using (true);

drop policy if exists "matches_public_read" on public.matches;
create policy "matches_public_read" on public.matches
for select using (true);

drop policy if exists "teams_public_write" on public.teams;
drop policy if exists "teams_admin_insert" on public.teams;
drop policy if exists "teams_admin_update" on public.teams;
drop policy if exists "teams_admin_delete" on public.teams;

create policy "teams_admin_insert"
on public.teams
for insert
to authenticated
with check (public.is_admin());

create policy "teams_admin_update"
on public.teams
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "teams_admin_delete"
on public.teams
for delete
to authenticated
using (public.is_admin());

drop policy if exists "matches_public_write" on public.matches;
drop policy if exists "matches_admin_insert" on public.matches;
drop policy if exists "matches_admin_update" on public.matches;
drop policy if exists "matches_admin_delete" on public.matches;

create policy "matches_admin_insert"
on public.matches
for insert
to authenticated
with check (public.is_admin());

create policy "matches_admin_update"
on public.matches
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "matches_admin_delete"
on public.matches
for delete
to authenticated
using (public.is_admin());

-- Storage: everyone can view logos, but only admins can upload/change/delete.
drop policy if exists "team_logos_public_write" on storage.objects;
drop policy if exists "team_logos_admin_insert" on storage.objects;
drop policy if exists "team_logos_admin_update" on storage.objects;
drop policy if exists "team_logos_admin_delete" on storage.objects;

create policy "team_logos_admin_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'team-logos'
  and public.is_admin()
);

create policy "team_logos_admin_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'team-logos'
  and public.is_admin()
)
with check (
  bucket_id = 'team-logos'
  and public.is_admin()
);

create policy "team_logos_admin_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'team-logos'
  and public.is_admin()
);

-- IMPORTANT:
-- After creating the first admin account in Supabase Authentication > Users,
-- insert that user's UUID here:
--
-- insert into public.admin_users (user_id)
-- values ('PASTE-AUTH-USER-UUID-HERE')
-- on conflict (user_id) do nothing;
