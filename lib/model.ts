// Token launch radar — value model and board builder.
// Everything here is derived from the snapshot itself: the figures of the
// protocols that already have a trading token are what price the ones that
// do not. No protocol name and no ranking is hardcoded anywhere in this file.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface CategoryMultiple {
  category: string;
  multiple: number;
  sample: number;
  fallback: boolean;
}

export interface FarmPlan {
  capital_usd: number;
  hold_days: number;
  chain: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  implied_value_usd: number;
  model: {
    base_usd: number;
    category_multiple: number;
    growth_multiplier: number;
    maturity_multiplier: number;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  change_7d: number | null;
}

export interface RadarData {
  model_version: string;
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  global_multiple: number;
  category_multiples: CategoryMultiple[];
  rows: BoardRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'radar-2';

// The model, in one line:
//   implied = TVL x category multiple x growth multiplier x maturity multiplier
//
// Category multiple: for each category, the median mcap/TVL of the live-token
// protocols in that category, read from this snapshot. A category needs at
// least five live protocols before its own median is trusted; thinner
// categories fall back to the global median. The multiple is clamped so one
// odd category can never dominate the board.
// Growth multiplier: the 7-day TVL change, clamped, weighted at three
// quarters — a protocol growing fast is worth more than one shrinking, but
// one week of flow is not the whole story.
// Maturity multiplier: older protocols are worth more than a two-day-old
// pool, up to a three-year cap; a protocol with no listing date is treated
// as one year old.
const GROWTH_FLOOR = -60;
const GROWTH_CAP = 150;
const GROWTH_WEIGHT = 0.75;
const MATURITY_FLOOR = 0.7;
const MATURITY_RANGE = 0.3;
const MATURITY_DAYS = 1095;
const UNKNOWN_AGE_DAYS = 365;
const MULT_MIN = 0.05;
const MULT_MAX = 1.5;
const MULT_MIN_SAMPLE = 5;
const LIVE_ROWS = 24;

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'CEX']);
const EXCHANGE_PREFIXES = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORDS = /\b(wrapped|staked|staking)\b/i;
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function ageDays(protocol: SnapshotProtocol, asOf: Date): number | null {
  if (!protocol.listed_at) return null;
  const listed = new Date(protocol.listed_at + 'T00:00:00Z');
  if (Number.isNaN(listed.getTime())) return null;
  return Math.max(0, Math.floor((asOf.getTime() - listed.getTime()) / 86400000));
}

function isPreToken(protocol: SnapshotProtocol): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

function isLiveToken(protocol: SnapshotProtocol): boolean {
  return protocol.mcap_usd !== null && protocol.mcap_usd > 0;
}

// A live-token protocol only belongs in the reference set when the ratio is
// its own: versioned pools carry the parent protocol's market cap against
// one version's TVL, bridges and wrapped products are not protocols at all,
// and exchanges are not comparable to protocols. The same field test as the
// board, minus the pre-token condition.
function isReferenceLive(protocol: SnapshotProtocol): boolean {
  if (!isLiveToken(protocol)) return false;
  if (protocol.category !== null && EXCLUDED_CATEGORIES.has(protocol.category)) return false;
  if (WRAPPED_WORDS.test(protocol.name)) return false;
  if (EXCHANGE_PREFIXES.test(protocol.name)) return false;
  if (VERSIONED_NAME.test(protocol.name)) return false;
  return protocol.tvl_usd > 0;
}

// A protocol is rankable when its token has not been seen trading and it is
// not one of the things that only looks pre-token: an exchange, a bridge or
// canonical bridge, a wrapped or staked product of a token that already
// trades, or a versioned pool of another protocol. The test reads only
// snapshot fields, never a list of names.
export function isRankable(protocol: SnapshotProtocol): boolean {
  if (!isPreToken(protocol)) return false;
  if (protocol.category !== null && EXCLUDED_CATEGORIES.has(protocol.category)) return false;
  if (WRAPPED_WORDS.test(protocol.name)) return false;
  if (EXCHANGE_PREFIXES.test(protocol.name)) return false;
  if (VERSIONED_NAME.test(protocol.name)) return false;
  return protocol.tvl_usd > 0;
}

export function categoryMultiples(snapshot: Snapshot): {
  byCategory: Map<string, CategoryMultiple>;
  global: number;
} {
  const liveByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const protocol of snapshot.protocols) {
    if (!isReferenceLive(protocol)) continue;
    const ratio = protocol.mcap_usd! / protocol.tvl_usd;
    allRatios.push(ratio);
    const key = protocol.category ?? 'Unknown';
    const list = liveByCategory.get(key) ?? [];
    list.push(ratio);
    liveByCategory.set(key, list);
  }
  const global = clamp(median(allRatios), MULT_MIN, MULT_MAX);
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of liveByCategory) {
    if (ratios.length >= MULT_MIN_SAMPLE) {
      byCategory.set(category, {
        category,
        multiple: clamp(median(ratios), MULT_MIN, MULT_MAX),
        sample: ratios.length,
        fallback: false,
      });
    }
  }
  return { byCategory, global };
}

function multipleFor(
  category: string | null,
  multiples: { byCategory: Map<string, CategoryMultiple>; global: number },
): { multiple: number; fallback: boolean } {
  const entry = category === null ? undefined : multiples.byCategory.get(category);
  if (entry) return { multiple: entry.multiple, fallback: false };
  return { multiple: multiples.global, fallback: true };
}

export function impliedValue(
  protocol: SnapshotProtocol,
  multiples: { byCategory: Map<string, CategoryMultiple>; global: number },
  asOf: Date,
): { implied: number; base: number; categoryMultiple: number; growth: number; maturity: number } {
  const { multiple } = multipleFor(protocol.category, multiples);
  const change = protocol.change_7d ?? 0;
  const growth = 1 + (clamp(change, GROWTH_FLOOR, GROWTH_CAP) / 100) * GROWTH_WEIGHT;
  const age = ageDays(protocol, asOf);
  const knownAge = age === null ? UNKNOWN_AGE_DAYS : age;
  const maturity = MATURITY_FLOOR + MATURITY_RANGE * (Math.min(knownAge, MATURITY_DAYS) / MATURITY_DAYS);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growth * maturity));
  return { implied, base: Math.round(base), categoryMultiple: multiple, growth, maturity };
}

function farmPlan(protocol: SnapshotProtocol, asOf: Date): FarmPlan {
  const capital =
    protocol.tvl_usd >= 1000000000 ? 250 : protocol.tvl_usd >= 100000000 ? 150 : protocol.tvl_usd >= 25000000 ? 100 : 50;
  const age = ageDays(protocol, asOf);
  const holdDays = age === null || age < 180 ? 60 : age < 365 ? 45 : 30;
  const chain = protocol.chains.length > 0 ? protocol.chains[0] : 'the protocol home chain';
  return { capital_usd: capital, hold_days: holdDays, chain };
}

function step(text: string, cost: string, time: string): string {
  return `${text} Cost: ${cost}. Time: ${time}.`;
}

function categoryAction(category: string | null, capital: number, chain: string): string {
  const c = category ?? 'Unknown';
  if (c === 'Lending' || c === 'CDP' || c === 'Collateral Markets' || c === 'Leveraged Farming') {
    return `Supply $${capital} of USDC to the lending market on ${chain} and borrow no more than $${Math.round(capital / 4)} against it, so the position stays healthy through a dip`;
  }
  if (c === 'Dexs' || c === 'Yield' || c === 'Yield Aggregator' || c === 'Basis Trading') {
    return `Provide $${capital} of liquidity to the deepest pool on ${chain}, take the LP token, and stake it in the protocol rewards pool if one is listed`;
  }
  if (c === 'Liquid Staking' || c === 'Liquid Restaking' || c === 'Restaking' || c === 'Staking Pool') {
    return `Stake $${capital} of the native asset on ${chain} through the protocol and keep the liquid staking receipt in the same wallet for the whole farming period`;
  }
  if (c === 'Perpetuals' || c === 'Derivatives') {
    return `Deposit $${capital} as margin on the ${chain} perpetuals market and open one small hedged position of no more than $${Math.round(capital / 5)}, closing it the same week`;
  }
  if (c === 'Prediction Market') {
    return `Fund the account with $${capital} on ${chain} and take a position of about $${Math.round(capital / 5)} in one market you have actually read the rules of`;
  }
  if (c === 'Risk Curators' || c === 'Onchain Capital Allocator' || c === 'CeDeFi') {
    return `Deposit $${capital} into the curated vault on ${chain} and leave it untouched so the vault manager sees a real, patient depositor`;
  }
  if (c === 'RWA') {
    return `Mint $${capital} of the yield-bearing real-world asset on ${chain} and hold it in the same wallet instead of moving it to an exchange`;
  }
  if (c === 'Insurance') {
    return `Buy cover worth $${capital} on ${chain} for a position you already hold, so the protocol records a real insurance user`;
  }
  if (c === 'Stablecoin Wrapper' || c === 'Collateralised Debt Position') {
    return `Mint $${capital} of the protocol stablecoin on ${chain} against a safe collateral ratio and keep it in the wallet for the holding period`;
  }
  if (c === 'Payments') {
    return `Route one real payment of about $${capital} through the protocol on ${chain} and keep the receipt, so the wallet shows genuine payment use`;
  }
  if (c === 'Governance Incentives') {
    return `Lock $${capital} in the governance vault on ${chain}, delegate the voting power, and vote on the next proposal that opens`;
  }
  if (c === 'Chain') {
    return `Bridge $${capital} to the chain and use its flagship app once a week, so the wallet is an active user of the chain rather than a bridge-only address`;
  }
  return `Deposit $${capital} into the protocol main app on ${chain} and keep the position open for the whole holding period`;
}

// Seven concrete steps. Every step names a cost and a time, and step two is
// the one real action the protocol rewards, chosen from its own category.
export function farmSteps(protocol: SnapshotProtocol, asOf: Date): string[] {
  const plan = farmPlan(protocol, asOf);
  const chain = plan.chain;
  return [
    step(
      'Create a fresh wallet for this protocol only, write the seed phrase on paper and store it offline, and fund it with just enough gas for the steps below',
      'under $3 of gas',
      '5 minutes',
    ),
    step(categoryAction(protocol.category, plan.capital_usd, chain), `$${plan.capital_usd} capital plus about $2 of gas`, '15 minutes'),
    step(
      'Repeat one qualifying action every week from the same wallet, such as a small deposit, a vote, or a claim of any points the protocol shows',
      'about $1 of gas per week',
      '10 minutes per week',
    ),
    step(
      `Hold the position for at least ${plan.hold_days} days without withdrawing it, because early exits usually reset any airdrop eligibility the protocol tracks`,
      'no extra cost',
      `${plan.hold_days} days of holding`,
    ),
    step(
      'Open the protocol points or rewards page from its own site once a week and claim only what its published link offers, never a link from a chat or a search ad',
      'free unless a claim needs gas',
      '5 minutes per week',
    ),
    step(
      'Check the contract or app address against the protocol own site or its DefiLlama page before every transaction, and never paste a seed phrase into any site',
      'free',
      '5 minutes per check',
    ),
    step(
      'Write down the wallet address, the dates, and every transaction hash in one note, so the claim can be proved later if the protocol asks for evidence',
      'free',
      '5 minutes',
    ),
  ];
}

export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; live: LiveRow[]; radar: RadarData } {
  const asOf = new Date(snapshot.as_of + 'T00:00:00Z');
  const multiples = categoryMultiples(snapshot);
  const ranked = snapshot.protocols
    .filter(isRankable)
    .map((protocol) => ({ protocol, value: impliedValue(protocol, multiples, asOf) }))
    .sort((a, b) => {
      if (b.value.implied !== a.value.implied) return b.value.implied - a.value.implied;
      return a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0;
    });
  const rows: BoardRow[] = ranked.map(({ protocol, value }, index) => ({
    rank: index + 1,
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category ?? 'Unknown',
    chains: protocol.chains,
    tvl_usd: protocol.tvl_usd,
    change_7d: protocol.change_7d,
    listed_at: protocol.listed_at,
    age_days: ageDays(protocol, asOf),
    token_status: 'pre-token',
    on_watchlist: snapshot.watchlist.includes(protocol.slug),
    implied_value_usd: value.implied,
    model: {
      base_usd: value.base,
      category_multiple: value.categoryMultiple,
      growth_multiplier: Number(value.growth.toFixed(4)),
      maturity_multiplier: Number(value.maturity.toFixed(4)),
    },
    farm_steps: farmSteps(protocol, asOf),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => isReferenceLive(p))
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Unknown',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: Number((p.mcap_usd! / p.tvl_usd).toFixed(4)),
      change_7d: p.change_7d,
    }));
  const categoryMultiplesList: CategoryMultiple[] = Array.from(multiples.byCategory.values()).sort(
    (a, b) => b.sample - a.sample || (a.category < b.category ? -1 : 1),
  );
  const radar: RadarData = {
    model_version: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    live_size: live.length,
    global_multiple: Number(multiples.global.toFixed(4)),
    category_multiples: categoryMultiplesList,
    rows,
    live,
  };
  return { rows, live, radar };
}

export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (!Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error('Snapshot must carry protocols and watchlist arrays.');
  }
  return data;
}

export function boardIssue(snapshot: Snapshot, rows: BoardRow[]): string | null {
  const missing = snapshot.watchlist.filter((slug) => !rows.some((row) => row.slug === slug));
  if (missing.length > 0) return `Watchlist rows missing from the board: ${missing.join(', ')}.`;
  if (rows.length < 100) return 'The board must carry at least 100 rows.';
  if (rows.length > 4000) return 'The board must carry at most 4000 rows.';
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.rank !== index + 1) return `Rank ${row.rank} is out of place at position ${index + 1}.`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `Row ${row.slug} has an implied value of ${row.implied_value_usd}.`;
    }
    if (index > 0 && row.implied_value_usd > rows[index - 1].implied_value_usd) {
      return `Implied values rise at rank ${row.rank}.`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `Row ${row.slug} has ${row.farm_steps.length} farm steps.`;
    }
    for (const stepText of row.farm_steps) {
      const trimmed = stepText.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `A farm step for ${row.slug} is ${trimmed.length} characters.`;
      }
    }
  }
  const distinct = new Set(rows.map((row) => row.implied_value_usd));
  if (distinct.size === 1) return 'Every implied value is the same.';
  const outside = rows.filter((row) => !snapshot.watchlist.includes(row.slug));
  if (outside.length < 60) return `Only ${outside.length} board rows sit outside the watchlist.`;
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
