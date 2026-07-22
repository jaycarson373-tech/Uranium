select
  rank,
  wallet,
  power,
  total_burned,
  total_claimed,
  total_compounded,
  active_rigs,
  updated_at
from public.leaderboard
order by rank
limit 100;
