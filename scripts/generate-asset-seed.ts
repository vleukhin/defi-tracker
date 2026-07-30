/**
 * Генератор сид-миграции справочника активов из TS-allowlist.
 * Единственный источник истины — src/lib/chains/allowlist.ts;
 * после его изменения перегенерировать SQL:
 *
 *   node scripts/generate-asset-seed.ts > supabase/migrations/20260730000010_seed_assets.sql
 *
 * SQL идемпотентен (on conflict ... do update) — повторный прогон безопасен.
 */
import { CHAIN_IDS } from "../src/lib/chains/config.ts";
import { NATIVE_ASSET, TOKEN_ALLOWLIST } from "../src/lib/chains/allowlist.ts";

const sqlStr = (v: string | null): string =>
  v === null ? "null" : `'${v.replace(/'/g, "''")}'`;

interface Row {
  chain: string;
  contract: string | null;
  symbol: string;
  decimals: number;
  coingeckoId: string | null;
  kind: "native" | "erc20";
}

const rows: Row[] = [];

for (const chain of CHAIN_IDS) {
  rows.push({
    chain,
    contract: null,
    symbol: NATIVE_ASSET.symbol,
    decimals: NATIVE_ASSET.decimals,
    coingeckoId: NATIVE_ASSET.coingeckoId,
    kind: "native",
  });
  for (const t of TOKEN_ALLOWLIST[chain]) {
    rows.push({
      chain,
      contract: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
      coingeckoId: t.coingeckoId,
      kind: "erc20",
    });
  }
}

const assetValues = rows
  .map(
    (r) =>
      `  (${sqlStr(r.chain)}, ${sqlStr(r.contract)}, ${sqlStr(r.symbol)}, ${r.decimals}, ${sqlStr(r.coingeckoId)}, ${sqlStr(r.kind)})`,
  )
  .join(",\n");

const sql = `-- =============================================================================
-- СГЕНЕРИРОВАНО scripts/generate-asset-seed.ts — НЕ ПРАВИТЬ ВРУЧНУЮ.
-- Сид курируемого allowlist (ТЗ §3.2): справочник assets.
-- Идемпотентно: on conflict ... do update.
-- =============================================================================

insert into public.assets (chain, contract_address, symbol, decimals, coingecko_id, kind) values
${assetValues}
on conflict on constraint assets_chain_contract_address_kind_key
do update set
  symbol       = excluded.symbol,
  decimals     = excluded.decimals,
  coingecko_id = excluded.coingecko_id;
`;

process.stdout.write(sql);
