-- Banco de nuvem usado pela aplicação MercadoFlow.
-- Execute no SQL Editor do Supabase antes de publicar a aplicação.

create extension if not exists pgcrypto;

create table if not exists public.mercadoflow_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.mercadoflow_workspace_members (
  workspace_id uuid not null references public.mercadoflow_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','operator','read_only')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);

create table if not exists public.mercadoflow_workspace_state (
  workspace_id uuid primary key references public.mercadoflow_workspaces(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state)='object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.mercadoflow_has_workspace_access(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mercadoflow_workspace_members m
    where m.workspace_id=target_workspace_id and m.user_id=(select auth.uid())
  );
$$;

create or replace function public.mercadoflow_has_workspace_write_access(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mercadoflow_workspace_members m
    where m.workspace_id=target_workspace_id
      and m.user_id=(select auth.uid())
      and m.role in ('owner','admin','operator')
  );
$$;

create or replace function public.mercadoflow_create_workspace(workspace_name text, initial_state jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if length(trim(coalesce(workspace_name,''))) not between 1 and 160 then
    raise exception 'Workspace name must contain 1 to 160 characters';
  end if;
  if jsonb_typeof(initial_state) is distinct from 'object' or octet_length(initial_state::text)>10485760 then
    raise exception 'Initial application state must be an object smaller than 10 MB';
  end if;

  insert into public.mercadoflow_workspaces(name,created_by)
    values(trim(workspace_name),current_user_id) returning id into new_workspace_id;
  insert into public.mercadoflow_workspace_members(workspace_id,user_id,role)
    values(new_workspace_id,current_user_id,'owner');
  insert into public.mercadoflow_workspace_state(workspace_id,state,updated_by)
    values(new_workspace_id,initial_state,current_user_id);
  return new_workspace_id;
end;
$$;

create or replace function public.mercadoflow_save_workspace_state(
  target_workspace_id uuid,
  new_state jsonb,
  expected_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_revision bigint;
begin
  if (select auth.uid()) is null
     or not public.mercadoflow_has_workspace_write_access(target_workspace_id) then
    raise exception 'Not authorized to update this workspace';
  end if;
  if jsonb_typeof(new_state) is distinct from 'object' or octet_length(new_state::text)>10485760 then
    raise exception 'Application state must be an object smaller than 10 MB';
  end if;

  update public.mercadoflow_workspace_state
    set state=new_state, revision=revision+1, updated_by=(select auth.uid()), updated_at=now()
    where workspace_id=target_workspace_id and revision=expected_revision
    returning revision into next_revision;
  if next_revision is null then
    raise exception 'Workspace data changed in another session. Reload before saving again.'
      using errcode='40001';
  end if;
  return next_revision;
end;
$$;

alter table public.mercadoflow_workspaces enable row level security;
alter table public.mercadoflow_workspace_members enable row level security;
alter table public.mercadoflow_workspace_state enable row level security;

drop policy if exists mercadoflow_workspaces_member_read on public.mercadoflow_workspaces;
create policy mercadoflow_workspaces_member_read on public.mercadoflow_workspaces
  for select to authenticated using (public.mercadoflow_has_workspace_access(id));

drop policy if exists mercadoflow_members_self_read on public.mercadoflow_workspace_members;
create policy mercadoflow_members_self_read on public.mercadoflow_workspace_members
  for select to authenticated using (user_id=(select auth.uid()));

drop policy if exists mercadoflow_state_member_read on public.mercadoflow_workspace_state;
create policy mercadoflow_state_member_read on public.mercadoflow_workspace_state
  for select to authenticated using (public.mercadoflow_has_workspace_access(workspace_id));

revoke all on public.mercadoflow_workspaces from anon, authenticated;
revoke all on public.mercadoflow_workspace_members from anon, authenticated;
revoke all on public.mercadoflow_workspace_state from anon, authenticated;
grant select on public.mercadoflow_workspaces,public.mercadoflow_workspace_members,
  public.mercadoflow_workspace_state to authenticated;

revoke all on function public.mercadoflow_create_workspace(text,jsonb) from public,anon;
revoke all on function public.mercadoflow_save_workspace_state(uuid,jsonb,bigint) from public,anon;
grant execute on function public.mercadoflow_create_workspace(text,jsonb) to authenticated;
grant execute on function public.mercadoflow_save_workspace_state(uuid,jsonb,bigint) to authenticated;
revoke all on function public.mercadoflow_has_workspace_access(uuid) from public,anon;
revoke all on function public.mercadoflow_has_workspace_write_access(uuid) from public,anon;
grant execute on function public.mercadoflow_has_workspace_access(uuid),
  public.mercadoflow_has_workspace_write_access(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'mercadoflow-documents',
  'mercadoflow-documents',
  false,
  26214400,
  array['application/pdf','application/xml','text/xml','text/plain','image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists mercadoflow_documents_read on storage.objects;
create policy mercadoflow_documents_read on storage.objects
  for select to authenticated using (
    bucket_id='mercadoflow-documents'
    and exists (
      select 1 from public.mercadoflow_workspaces w
      where w.id::text=(storage.foldername(name))[1]
        and public.mercadoflow_has_workspace_access(w.id)
    )
  );

drop policy if exists mercadoflow_documents_insert on storage.objects;
create policy mercadoflow_documents_insert on storage.objects
  for insert to authenticated with check (
    bucket_id='mercadoflow-documents'
    and exists (
      select 1 from public.mercadoflow_workspaces w
      where w.id::text=(storage.foldername(name))[1]
        and public.mercadoflow_has_workspace_write_access(w.id)
    )
  );

drop policy if exists mercadoflow_documents_update on storage.objects;
create policy mercadoflow_documents_update on storage.objects
  for update to authenticated using (
    bucket_id='mercadoflow-documents'
    and exists (
      select 1 from public.mercadoflow_workspaces w
      where w.id::text=(storage.foldername(name))[1]
        and public.mercadoflow_has_workspace_write_access(w.id)
    )
  ) with check (
    bucket_id='mercadoflow-documents'
    and exists (
      select 1 from public.mercadoflow_workspaces w
      where w.id::text=(storage.foldername(name))[1]
        and public.mercadoflow_has_workspace_write_access(w.id)
    )
  );

drop policy if exists mercadoflow_documents_delete on storage.objects;
create policy mercadoflow_documents_delete on storage.objects
  for delete to authenticated using (
    bucket_id='mercadoflow-documents'
    and exists (
      select 1 from public.mercadoflow_workspaces w
      where w.id::text=(storage.foldername(name))[1]
        and public.mercadoflow_has_workspace_write_access(w.id)
    )
  );
