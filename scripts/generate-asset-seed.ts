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
import {
  BUILTIN_BUCKET_IDS,
  NATIVE_ASSET,
  TOKEN_ALLOWLIST,
} from "../src/lib/chains/allowlist.ts";

const sqlStr = (v: string | null): string =>
  v === null ? "null" : `'${v.replace(/'/g, "''")}'`;

interface Row {
  chain: string;
  contract: string | null;
  symbol: string;
  decimals: number;
  coingeckoId: string | null;
  kind: "native" | "erc20";
  bucketId: string | null;
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
    bucketId: BUILTIN_BUCKET_IDS[NATIVE_ASSET.defaultBucket],
  });
  for (const t of TOKEN_ALLOWLIST[chain]) {
    rows.push({
      chain,
      contract: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
      coingeckoId: t.coingeckoId,
      kind: "erc20",
      bucketId: t.defaultBucket ? BUILTIN_BUCKET_IDS[t.defaultBucket] : null,
    });
  }
}

const assetValues = rows
  .map(
    (r) =>
      `  (${sqlStr(r.chain)}, ${sqlStr(r.contract)}, ${sqlStr(r.symbol)}, ${r.decimals}, ${sqlStr(r.coingeckoId)}, ${sqlStr(r.kind)})`,
  )
  .join(",\n");

const mapped = rows.filter((r) => r.bucketId !== null);
const mapValues = mapped
  .map((r, i) => {
    const cast = i === 0;
    return `  (${sqlStr(r.chain)}${cast ? "::text" : ""}, ${sqlStr(r.contract)}${cast ? "::text" : ""}, ${sqlStr(r.kind)}${cast ? "::text" : ""}, ${sqlStr(r.bucketId)}${cast ? "::uuid" : ""})`;
  })
  .join(",\n");

const sql = `-- =============================================================================
-- СГЕНЕРИРОВАНО scripts/generate-asset-seed.ts — НЕ ПРАВИТЬ ВРУЧНУЮ.
-- Сид курируемого allowlist (ТЗ §3.2): assets + дефолтный asset_bucket_map.
-- Идемпотентно: on conflict ... do update; пользовательские override
-- (user_id is not null) не затрагиваются.
-- =============================================================================

insert into public.assets (chain, contract_address, symbol, decimals, coingecko_id, kind) values
${assetValues}
on conflict on constraint assets_chain_contract_address_kind_key
do update set
  symbol       = excluded.symbol,
  decimals     = excluded.decimals,
  coingecko_id = excluded.coingecko_id;

-- Дефолтный маппинг актив -> встроенная корзина (user_id IS NULL).
-- Активы без строки здесь попадают в «Прочее» на этапе агрегации.
insert into public.asset_bucket_map (asset_id, bucket_id, user_id)
select a.id, m.bucket_id, null
from (values
${mapValues}
) as m(chain, contract_address, kind, bucket_id)
join public.assets a
  on a.chain = m.chain
 and a.contract_address is not distinct from m.contract_address
 and a.kind = m.kind
on conflict on constraint asset_bucket_map_asset_id_user_id_key
do update set bucket_id = excluded.bucket_id;
`;

process.stdout.write(sql);
