-- Private data is accessible only through the authenticated Edge Function.
create table if not exists public.travel_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null, is_owner boolean not null default false, disabled boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.travel_invites (
  token_hash text primary key, email text not null, is_owner boolean not null default false,
  expires_at timestamptz not null, claimed_at timestamptz, created_by uuid references auth.users(id)
);
create table if not exists public.travel_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null, document jsonb not null, revisions jsonb not null default '[]',
  updated_at timestamptz not null default now(), primary key(user_id,id)
);
create table if not exists public.travel_models (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted text not null, updated_at timestamptz not null default now()
);
create table if not exists public.travel_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null, reserved numeric not null default 0, requests integer not null default 0,
  primary key(user_id,month)
);
create table if not exists public.travel_requests (
  user_id uuid not null references auth.users(id) on delete cascade, id uuid not null,
  action text not null, status text not null default 'pending', result jsonb,
  created_at timestamptz not null default now(), primary key(user_id,id)
);
create table if not exists public.travel_shares (
  token_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade,
  trip_id text not null, document jsonb not null, expires_at timestamptz not null,
  revoked boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.travel_posters (
  user_id uuid not null references auth.users(id) on delete cascade, trip_id text not null,
  version text not null, template text not null, page integer not null, image_ref text not null,
  created_at timestamptz not null default now(), primary key(user_id,trip_id,version,template,page)
);

alter table public.travel_members enable row level security;
alter table public.travel_invites enable row level security;
alter table public.travel_documents enable row level security;
alter table public.travel_models enable row level security;
alter table public.travel_usage enable row level security;
alter table public.travel_requests enable row level security;
alter table public.travel_shares enable row level security;
alter table public.travel_posters enable row level security;
revoke all on public.travel_members,public.travel_invites,public.travel_documents,public.travel_models,public.travel_usage,public.travel_requests,public.travel_shares,public.travel_posters from anon,authenticated;
grant all on public.travel_members,public.travel_invites,public.travel_documents,public.travel_models,public.travel_usage,public.travel_requests,public.travel_shares,public.travel_posters to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('private-travel','private-travel',false,8388608,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false;

-- Lock and compare version in one transaction; never silently overwrite another device.
create or replace function public.travel_save(p_user uuid,p_id text,p_document jsonb,p_kind text,p_expected text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous travel_documents%rowtype; stamp text; rev jsonb; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text||':'||p_id,0));
  select * into previous from travel_documents where user_id=p_user and id=p_id for update;
  if found and (p_expected is null or previous.document->>'updatedAt' is distinct from p_expected) then
    raise exception 'VERSION_CONFLICT';
  end if;
  stamp := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  p_document := jsonb_set(p_document,'{updatedAt}',to_jsonb(stamp));
  rev := coalesce(previous.revisions,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'kind',p_kind,'createdAt',stamp,'document',p_document));
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into rev from jsonb_array_elements(rev) with ordinality t(value,ord) where ord>jsonb_array_length(rev)-12;
  insert into travel_documents(user_id,id,document,revisions) values(p_user,p_id,p_document,rev)
  on conflict(user_id,id) do update set document=excluded.document,revisions=excluded.revisions,updated_at=now();
  return jsonb_build_object('trip',p_document,'revisions',rev);
end; $$;
revoke all on function public.travel_save(uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.travel_save(uuid,text,jsonb,text,text) to service_role;

-- A single atomic reservation protects budget and concurrency across devices.
create or replace function public.travel_reserve(p_user uuid,p_id uuid,p_action text,p_amount numeric,p_limit numeric)
returns boolean language plpgsql security definer set search_path=public as $$
declare m text:=to_char(now() at time zone 'Asia/Shanghai','YYYY-MM'); used numeric;
begin
  if p_amount<=0 or p_limit<0 then raise exception 'INVALID_BUDGET'; end if;
  insert into travel_requests(user_id,id,action) values(p_user,p_id,p_action) on conflict do nothing;
  if not found then return false; end if;
  insert into travel_usage(user_id,month) values(p_user,m) on conflict do nothing;
  select reserved into used from travel_usage where user_id=p_user and month=m for update;
  if used+p_amount>p_limit then raise exception 'BUDGET_LIMIT'; end if;
  if (select count(*) from travel_requests where user_id=p_user and created_at>now()-interval '1 minute')>10 then raise exception 'RATE_LIMIT'; end if;
  update travel_usage set reserved=reserved+p_amount,requests=requests+1 where user_id=p_user and month=m;
  return true;
end; $$;
revoke all on function public.travel_reserve(uuid,uuid,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.travel_reserve(uuid,uuid,text,numeric,numeric) to service_role;

-- Claim invitations atomically. Public Auth sign-up must remain disabled.
create or replace function public.travel_claim(p_hash text,p_email text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item travel_invites%rowtype;
begin
  select * into item from travel_invites where token_hash=p_hash and (lower(email)=lower(p_email) or (is_owner and email='*')) and claimed_at is null and expires_at>now() for update;
  if not found then raise exception 'INVALID_INVITE'; end if;
  update travel_invites set claimed_at=now() where token_hash=p_hash;
  return jsonb_build_object('is_owner',item.is_owner);
end; $$;
revoke all on function public.travel_claim(text,text) from public,anon,authenticated;
grant execute on function public.travel_claim(text,text) to service_role;
