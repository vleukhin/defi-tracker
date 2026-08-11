import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/api/auth";
import { alchemyRpcUrl, getChainClients, type ChainId } from "@/lib/chains/config";
import { findGmTransfers, type GmSearchRpcClient } from "@/lib/chains/gm-search";
import { logApiCall } from "@/lib/metrics";
import { fetchMarketChartRange } from "@/lib/prices/coingecko";

/** Бюджет HTTP-обработчика: при его исчерпании поиск возвращает partial. */
const SEARCH_BUDGET_MS = 22_000;

const querySchema = z.object({
  chain: z.literal("arbitrum"),
  externalId: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  walletId: z.string().uuid(),
});

/**
 * Фактические mint/burn GM за 14 дней (S8.5).
 *
 * Клиент передаёт только адрес рынка и сеть. Кошелёк и long asset берём из
 * принадлежащей пользователю строки protocol_positions: иначе поиск по
 * произвольному адресу стал бы обходом модели доступа приложения.
 */
export async function GET(request: NextRequest) {
  const { user, supabase, unauthorized } = await requireUser();
  if (!user) return unauthorized;

  const parsed = querySchema.safeParse({
    chain: request.nextUrl.searchParams.get("chain"),
    externalId: request.nextUrl.searchParams.get("externalId"),
    walletId: request.nextUrl.searchParams.get("walletId"),
  });
  if (!parsed.success) return apiError(400, "Неверная позиция GM для поиска");
  const { chain, externalId, walletId } = parsed.data;

  const { data: position, error: positionError } = await supabase
    .from("protocol_positions")
    .select("wallet_id, payload")
    .eq("protocol", "gmx_v2")
    .eq("chain", chain)
    .eq("external_id", externalId.toLowerCase())
    .eq("wallet_id", walletId)
    .maybeSingle();
  if (positionError) return apiError(500, positionError.message);
  if (!position) return apiError(404, "GM-пул не найден среди позиций");

  const { data: wallet, error: walletError } = await supabase
    .from("wallets").select("address").eq("id", walletId).maybeSingle();
  if (walletError) return apiError(500, walletError.message);
  if (!wallet) return apiError(404, "Кошелёк позиции не найден");

  const payload = position.payload as {
    components?: { side?: unknown; symbol?: unknown; coingeckoId?: unknown }[];
  } | null;
  const long = payload?.components?.find((component) => component.side === "long");
  const longSymbol = typeof long?.symbol === "string" ? long.symbol : null;
  const coingeckoId = typeof long?.coingeckoId === "string" ? long.coingeckoId : null;
  const clients = getChainClients() as unknown as Record<ChainId, GmSearchRpcClient>;
  const nowMs = Date.now();
  const response = await findGmTransfers(
    { gmToken: externalId, wallet: String(wallet.address), longSymbol, coingeckoId },
    {
      client: clients[chain], fetchFn: fetch, alchemyUrl: alchemyRpcUrl(chain),
      logCall: logApiCall, nowMs: () => Date.now(), deadlineMs: nowMs + SEARCH_BUDGET_MS,
      cg: { fetchRange: fetchMarketChartRange },
    },
  );
  return NextResponse.json(response);
}
