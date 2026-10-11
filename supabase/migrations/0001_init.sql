-- esquema inicial do imagginai (seção 3.11)
-- deve ser aplicado manualmente pelo usuário no sql editor do supabase

create extension if not exists vector with schema extensions;

-- é mantido o updated_at automaticamente em todas as tabelas mutáveis
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- zonas ------------------------------------------------------------------

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  environment text not null check (environment in ('focus-dark', 'focus-nature')),
  layout jsonb not null default '[]'::jsonb,
  pack_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index zones_user_id_idx on public.zones (user_id);

create trigger zones_set_updated_at
before update on public.zones
for each row execute function public.set_updated_at();

-- fontes (pdfs enviados) -------------------------------------------------

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  zone_id uuid not null references public.zones (id) on delete cascade,
  title text not null,
  storage_path text not null,
  -- limites de upload da seção 3.10 (60 páginas, 20 mb)
  page_count integer not null check (page_count between 1 and 60),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 20971520),
  created_at timestamptz not null default now()
);

create index sources_zone_id_idx on public.sources (zone_id);

-- trechos com embeddings (o id é usado como chunkId nas âncoras) ---------

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  zone_id uuid not null references public.zones (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  page integer not null check (page >= 1),
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  token_count integer not null check (token_count > 0),
  embedding extensions.vector(768),
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index chunks_zone_id_idx on public.chunks (zone_id);
create index chunks_embedding_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- study packs (json no storage, metadados aqui) --------------------------

create table public.packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  zone_id uuid not null references public.zones (id) on delete cascade,
  storage_path text not null,
  schema_version text not null default '1.0',
  prompt_version text not null,
  model text not null,
  discarded integer not null default 0 check (discarded >= 0),
  created_at timestamptz not null default now()
);

create index packs_zone_id_idx on public.packs (zone_id);

alter table public.zones
  add constraint zones_pack_id_fkey
  foreign key (pack_id) references public.packs (id) on delete set null;

-- jobs de ingestão e geração ---------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  zone_id uuid not null references public.zones (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_zone_id_idx on public.jobs (zone_id);

create trigger jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

-- consentimentos (seção 3.9) ---------------------------------------------

create table public.consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  telemetry_local boolean not null default false,
  research boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger consents_set_updated_at
before update on public.consents
for each row execute function public.set_updated_at();

-- agregados de sessão (somente métricas agregadas, nunca dados brutos) ---

create table public.session_aggregates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  zone_id uuid not null references public.zones (id) on delete cascade,
  session_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  -- o envio é idempotente para a fila de reenvio offline
  unique (user_id, session_id)
);

create index session_aggregates_zone_id_idx on public.session_aggregates (zone_id);

-- row level security: cada usuário acessa apenas as próprias linhas -------

alter table public.zones enable row level security;
alter table public.sources enable row level security;
alter table public.chunks enable row level security;
alter table public.packs enable row level security;
alter table public.jobs enable row level security;
alter table public.consents enable row level security;
alter table public.session_aggregates enable row level security;

create policy zones_owner_all on public.zones
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy sources_owner_all on public.sources
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy chunks_owner_all on public.chunks
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy packs_owner_all on public.packs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy jobs_owner_all on public.jobs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy consents_owner_all on public.consents
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy session_aggregates_owner_all on public.session_aggregates
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- storage: buckets privados, organizados por pasta do usuário -------------

insert into storage.buckets (id, name, public)
values ('sources', 'sources', false), ('packs', 'packs', false)
on conflict (id) do nothing;

-- o primeiro segmento do caminho do objeto é o id do usuário dono
create policy storage_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id in ('sources', 'packs')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy storage_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('sources', 'packs')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
