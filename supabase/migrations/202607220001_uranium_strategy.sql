create table if not exists public.protocol_state (
  id text primary key default 'canonical' check (id = 'canonical'),
  authority text,
  mint text,
  fixed_supply bigint not null default 0 check (fixed_supply >= 0),
  reserve_funded bigint not null default 0 check (reserve_funded >= 0),
  rewards_claimed bigint not null default 0 check (rewards_claimed >= 0),
  total_burned bigint not null default 0 check (total_burned >= 0),
  paused boolean not null default false,
  season_end_at timestamptz,
  last_slot bigint not null default 0 check (last_slot >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.miners (
  wallet text primary key,
  power bigint not null default 0 check (power >= 0),
  total_burned bigint not null default 0 check (total_burned >= 0),
  total_claimed bigint not null default 0 check (total_claimed >= 0),
  total_compounded bigint not null default 0 check (total_compounded >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rigs (
  wallet text not null references public.miners(wallet) on delete cascade,
  cell smallint not null check (cell between 0 and 24),
  level smallint not null default 0 check (level between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (wallet, cell)
);

create table if not exists public.protocol_events (
  signature text not null,
  log_index integer not null check (log_index >= 0),
  chain_slot bigint not null check (chain_slot >= 0),
  block_time timestamptz,
  event_type text not null,
  wallet text,
  cell smallint check (cell is null or cell between 0 and 24),
  payload jsonb not null default '{}'::jsonb,
  raw_data text not null,
  created_at timestamptz not null default now(),
  primary key (signature, log_index)
);

create table if not exists public.indexer_state (
  name text primary key,
  latest_signature text,
  latest_slot bigint not null default 0 check (latest_slot >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists protocol_events_slot_idx
  on public.protocol_events (chain_slot desc, log_index desc);
create index if not exists protocol_events_wallet_idx
  on public.protocol_events (wallet, chain_slot desc)
  where wallet is not null;
create index if not exists miners_power_idx
  on public.miners (power desc, total_burned desc);

create or replace view public.leaderboard
with (security_invoker = true)
as
select
  dense_rank() over (order by m.power desc, m.total_burned desc, m.wallet) as rank,
  m.wallet,
  m.power,
  m.total_burned,
  m.total_claimed,
  m.total_compounded,
  count(r.cell) filter (where r.level > 0) as active_rigs,
  m.updated_at
from public.miners m
left join public.rigs r on r.wallet = m.wallet
group by m.wallet;

alter table public.protocol_state enable row level security;
alter table public.miners enable row level security;
alter table public.rigs enable row level security;
alter table public.protocol_events enable row level security;
alter table public.indexer_state enable row level security;

drop policy if exists "protocol state is publicly readable" on public.protocol_state;
create policy "protocol state is publicly readable"
  on public.protocol_state for select
  to anon, authenticated
  using (true);

drop policy if exists "miners are publicly readable" on public.miners;
create policy "miners are publicly readable"
  on public.miners for select
  to anon, authenticated
  using (true);

drop policy if exists "rigs are publicly readable" on public.rigs;
create policy "rigs are publicly readable"
  on public.rigs for select
  to anon, authenticated
  using (true);

drop policy if exists "events are publicly readable" on public.protocol_events;
create policy "events are publicly readable"
  on public.protocol_events for select
  to anon, authenticated
  using (true);

create or replace function public.ingest_protocol_event(
  p_signature text,
  p_log_index integer,
  p_chain_slot bigint,
  p_block_time timestamptz,
  p_event_type text,
  p_wallet text,
  p_cell smallint,
  p_payload jsonb,
  p_raw_data text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
  burn_amount bigint;
  claim_net bigint;
  claim_fee bigint;
  compound_amount bigint;
  power_value bigint;
  rig_level smallint;
begin
  if p_signature is null or length(p_signature) < 32 then
    raise exception 'invalid signature';
  end if;
  if p_chain_slot < 0 or p_log_index < 0 then
    raise exception 'invalid chain position';
  end if;
  if p_cell is not null and (p_cell < 0 or p_cell > 24) then
    raise exception 'invalid rig cell';
  end if;

  insert into public.protocol_events (
    signature, log_index, chain_slot, block_time, event_type,
    wallet, cell, payload, raw_data
  ) values (
    p_signature, p_log_index, p_chain_slot, p_block_time, p_event_type,
    p_wallet, p_cell, coalesce(p_payload, '{}'::jsonb), p_raw_data
  ) on conflict do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    return false;
  end if;

  if p_event_type = 'ProtocolInitialized' then
    insert into public.protocol_state (
      id, authority, mint, fixed_supply, season_end_at, last_slot, updated_at
    ) values (
      'canonical', p_payload->>'authority', p_payload->>'mint',
      (p_payload->>'fixed_supply')::bigint,
      to_timestamp((p_payload->>'season_end_ts')::double precision),
      p_chain_slot, now()
    ) on conflict (id) do update set
      authority = excluded.authority,
      mint = excluded.mint,
      fixed_supply = excluded.fixed_supply,
      season_end_at = excluded.season_end_at,
      last_slot = greatest(protocol_state.last_slot, excluded.last_slot),
      updated_at = now();

  elsif p_event_type = 'ReserveFunded' then
    insert into public.protocol_state (id, reserve_funded, last_slot, updated_at)
    values ('canonical', (p_payload->>'reserve_funded')::bigint, p_chain_slot, now())
    on conflict (id) do update set
      reserve_funded = excluded.reserve_funded,
      last_slot = greatest(protocol_state.last_slot, excluded.last_slot),
      updated_at = now();

  elsif p_event_type = 'MinerInitialized' then
    insert into public.miners (wallet) values (p_wallet)
    on conflict (wallet) do nothing;

  elsif p_event_type = 'RigBuilt' then
    burn_amount := (p_payload->>'burn_amount')::bigint;
    power_value := (p_payload->>'total_power')::bigint;
    rig_level := (p_payload->>'level')::smallint;

    insert into public.miners (wallet, power, total_burned, updated_at)
    values (p_wallet, power_value, burn_amount, now())
    on conflict (wallet) do update set
      power = excluded.power,
      total_burned = miners.total_burned + burn_amount,
      updated_at = now();

    insert into public.rigs (wallet, cell, level, updated_at)
    values (p_wallet, p_cell, rig_level, now())
    on conflict (wallet, cell) do update set
      level = excluded.level,
      updated_at = now();

    insert into public.protocol_state (id, total_burned, last_slot, updated_at)
    values ('canonical', burn_amount, p_chain_slot, now())
    on conflict (id) do update set
      total_burned = protocol_state.total_burned + burn_amount,
      last_slot = greatest(protocol_state.last_slot, excluded.last_slot),
      updated_at = now();

  elsif p_event_type = 'RewardsClaimed' then
    claim_net := (p_payload->>'net')::bigint;
    claim_fee := (p_payload->>'fee')::bigint;

    update public.miners set
      total_claimed = total_claimed + claim_net,
      updated_at = now()
    where wallet = p_wallet;

    insert into public.protocol_state (
      id, rewards_claimed, total_burned, last_slot, updated_at
    ) values (
      'canonical', (p_payload->>'gross')::bigint, claim_fee, p_chain_slot, now()
    ) on conflict (id) do update set
      rewards_claimed = protocol_state.rewards_claimed + excluded.rewards_claimed,
      total_burned = protocol_state.total_burned + excluded.total_burned,
      last_slot = greatest(protocol_state.last_slot, excluded.last_slot),
      updated_at = now();

  elsif p_event_type = 'RewardsCompounded' then
    compound_amount := (p_payload->>'gross_consumed')::bigint;
    power_value := (p_payload->>'power_added')::bigint;

    update public.miners set
      power = power + power_value,
      total_compounded = total_compounded + compound_amount,
      updated_at = now()
    where wallet = p_wallet;

    update public.rigs set
      level = least(100, level + power_value::smallint),
      updated_at = now()
    where wallet = p_wallet and cell = p_cell;

    insert into public.protocol_state (
      id, rewards_claimed, total_burned, last_slot, updated_at
    ) values (
      'canonical', compound_amount, compound_amount, p_chain_slot, now()
    ) on conflict (id) do update set
      rewards_claimed = protocol_state.rewards_claimed + excluded.rewards_claimed,
      total_burned = protocol_state.total_burned + excluded.total_burned,
      last_slot = greatest(protocol_state.last_slot, excluded.last_slot),
      updated_at = now();

  elsif p_event_type = 'PauseChanged' then
    insert into public.protocol_state (id, paused, last_slot, updated_at)
    values ('canonical', (p_payload->>'paused')::boolean, p_chain_slot, now())
    on conflict (id) do update set
      paused = excluded.paused,
      last_slot = greatest(protocol_state.last_slot, excluded.last_slot),
      updated_at = now();
  end if;

  return true;
end;
$$;

create or replace function public.set_indexer_cursor(
  p_name text,
  p_latest_signature text,
  p_latest_slot bigint
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.indexer_state (name, latest_signature, latest_slot, updated_at)
  values (p_name, p_latest_signature, p_latest_slot, now())
  on conflict (name) do update set
    latest_signature = excluded.latest_signature,
    latest_slot = greatest(indexer_state.latest_slot, excluded.latest_slot),
    updated_at = now();
$$;

revoke all on function public.ingest_protocol_event(
  text, integer, bigint, timestamptz, text, text, smallint, jsonb, text
) from public, anon, authenticated;
revoke all on function public.set_indexer_cursor(text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.ingest_protocol_event(
  text, integer, bigint, timestamptz, text, text, smallint, jsonb, text
) to service_role;
grant execute on function public.set_indexer_cursor(text, text, bigint)
  to service_role;

grant select on public.protocol_state, public.miners, public.rigs,
  public.protocol_events to anon, authenticated;
grant select on public.leaderboard to anon, authenticated;
