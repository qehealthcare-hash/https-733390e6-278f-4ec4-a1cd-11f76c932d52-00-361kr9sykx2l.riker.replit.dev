-- Maths Mania m9 — marketing capture (replaces jsonl when Supabase is wired)

create table public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'website',
  subscribed_at timestamptz not null default now(),
  ip_hash text,
  unique (email)
);

create index idx_newsletter_email on public.newsletter_subscribers (email);

create table public.resource_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  whatsapp text,
  resource_id text not null default '',
  resource_title text not null default '',
  source text not null default 'resource-download',
  captured_at timestamptz not null default now(),
  ip_hash text
);

create index idx_resource_leads_email on public.resource_leads (email);
create index idx_resource_leads_resource on public.resource_leads (resource_id);

alter table public.newsletter_subscribers enable row level security;
alter table public.resource_leads enable row level security;

-- No direct client writes — API routes use service role only
create policy "newsletter_no_client_access"
  on public.newsletter_subscribers
  for all
  using (false);

create policy "resource_leads_no_client_access"
  on public.resource_leads
  for all
  using (false);
