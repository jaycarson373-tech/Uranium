create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  name varchar(24) not null check (length(btrim(name)) between 1 and 24),
  message varchar(280) not null check (length(btrim(message)) between 1 and 280),
  created_at timestamptz not null default now()
);

create table if not exists public.chat_rate_limits (
  sender_hash text primary key check (length(sender_hash) = 64),
  window_started_at timestamptz not null default now(),
  window_count integer not null default 0 check (window_count between 0 and 30),
  last_message_at timestamptz
);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;
alter table public.chat_rate_limits enable row level security;

revoke all on public.chat_messages, public.chat_rate_limits
  from public, anon, authenticated;
grant select on public.chat_messages to service_role;

create or replace function public.post_chat_message(
  p_name text,
  p_message text,
  p_sender_hash text
)
returns table (
  id bigint,
  name varchar(24),
  message varchar(280),
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  limiter public.chat_rate_limits%rowtype;
  current_time timestamptz := clock_timestamp();
begin
  p_name := btrim(regexp_replace(p_name, '[[:cntrl:]]+', ' ', 'g'));
  p_message := btrim(regexp_replace(p_message, '[[:cntrl:]]+', ' ', 'g'));

  if length(p_name) < 1 or length(p_name) > 24 then
    raise exception 'invalid_chat_name';
  end if;
  if length(p_message) < 1 or length(p_message) > 280 then
    raise exception 'invalid_chat_message';
  end if;
  if p_sender_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_sender_hash';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_sender_hash, 0));
  select * into limiter
  from public.chat_rate_limits
  where sender_hash = p_sender_hash
  for update;

  if not found then
    insert into public.chat_rate_limits (
      sender_hash, window_started_at, window_count, last_message_at
    ) values (
      p_sender_hash, current_time, 1, current_time
    );
  else
    if limiter.last_message_at is not null
      and limiter.last_message_at > current_time - interval '4 seconds' then
      raise exception 'chat_rate_limited';
    end if;

    if limiter.window_started_at <= current_time - interval '1 hour' then
      update public.chat_rate_limits set
        window_started_at = current_time,
        window_count = 1,
        last_message_at = current_time
      where sender_hash = p_sender_hash;
    elsif limiter.window_count >= 30 then
      raise exception 'chat_rate_limited';
    else
      update public.chat_rate_limits set
        window_count = window_count + 1,
        last_message_at = current_time
      where sender_hash = p_sender_hash;
    end if;
  end if;

  return query
  insert into public.chat_messages (name, message)
  values (p_name, p_message)
  returning
    chat_messages.id,
    chat_messages.name,
    chat_messages.message,
    chat_messages.created_at;
end;
$$;

revoke all on function public.post_chat_message(text, text, text)
  from public, anon, authenticated;
grant execute on function public.post_chat_message(text, text, text)
  to service_role;
