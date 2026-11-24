# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Fanyway/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Fanyway/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a DefiLlama protocol snapshot and ranks every
pre-token protocol by an implied value derived from the snapshot's own
figures, then ships a sortable, filterable dashboard with a detail view and
seven concrete farming steps per protocol.

## How to run

```sh
node main.ts --input /input/snapshot.json --output /output
```

Node 22, standard library only, no network. The run is deterministic: two
runs write byte-identical output.

## How it works

**Implied value = TVL × category multiple × growth multiplier × maturity multiplier**

- **Category multiple** — the median market-cap-to-TVL of the live-token
  protocols in the same category, read from this snapshot. A category needs
  at least five live protocols before its own median is trusted; thinner
  categories fall back to the global median. Clamped to 0.05–1.50.
- **Growth multiplier** — 1 + 0.75 × the 7-day TVL change, clamped to
  −60%…+150%.
- **Maturity multiplier** — 0.70 + 0.30 × age ÷ 3 years; a protocol with no
  listing date is treated as one year old.

**What is ranked.** Only protocols whose token has not been seen trading.
Wrapped assets, staked products of tokens that already trade, bridges,
exchanges and versioned pools are not ranked, because none of them is a
protocol still waiting on its own token launch. The board covers all 40
protocols on the snapshot watchlist plus every other rankable pre-token
protocol in the snapshot.

**What is not ranked.** The 24 largest live-token protocols (exchanges
excluded) are shown separately in the dashboard as the reference set whose
market-cap-to-TVL ratios price the board.

## Output

- `board.json` — the ranked board (rank, slug, name, implied value, model
  breakdown, farm steps).
- `data.js` — the same data for the dashboard.
- `dashboard/` — the dashboard (sortable, filterable, detail view).
- `screenshots/` — three views of the dashboard.
- `dossier.json` — the dossier built by `vendor/makefun-board.ts`.

Entered on make.fun: https://make.fun/?ref=kyx210yc
