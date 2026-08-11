"use client";

import { History, Plus, TrendingDown } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip, StatusChip } from "@/components/dc/chip";
import { countLabel, plural } from "@/components/portfolio/plural";
import { SheetPopover } from "@/components/dc/sheet-popover";
import type { GmJournalDto, GmLevelActionDto, GmTransfersResponseDto, PositionDto } from "@/lib/api/types";
import { dcPp, dcUsd, tableDate, tablePct, tableQuantity } from "@/lib/format";
import { GM_GROWTH_LEVEL_KEY, gmLevels, type GmLevelsView } from "@/lib/positions/gm-levels";
import { ApiError, apiFetch } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * Шкала уровней GM-пула (docs/07 §5–§7): где стоит цена базового актива
 * относительно точки отсчёта, какие уровни действий уже позади и какой
 * ближайший.
 *
 * Живёт в поповере по той же причине, что и разметка: читают её в момент
 * решения, а не каждый день, и семь строк со списком действий отняли бы
 * у карточки место, отведённое числам.
 *
 * Шкала идёт сверху вниз по цене: ориентир фиксации на росте (+50%, §6),
 * сама точка отсчёта, затем уровни падения. Маркер «сейчас» встаёт между
 * строками ровно там, где стоит цена, — «где мы находимся» показывается
 * положением, а не подписью где-то сбоку.
 *
 * Чего шкала не знает: касались ли уровня раньше. Приложение видит только
 * текущую цену, поэтому «пройден» здесь значит «цена сейчас не выше», и
 * сноска внизу говорит об этом прямо.
 */
export function GmLevelsPopover({
  position,
  journal,
  busy,
  onJournalRefetch,
}: {
  position: PositionDto;
  journal: GmJournalDto | null;
  busy: boolean;
  onJournalRefetch: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<"action" | "reference" | null>(null);
  const [actionLevel, setActionLevel] = useState<number | null>(null);
  const current = journal?.points[0] ?? null;
  const view = gmLevels(position, current?.actions.map((action) => action.dropPercent));
  const set = view.entryPriceUsd !== null;
  const reached = view.reachedCount !== null && view.reachedCount > 0;

  return (
    // На телефоне — нижний лист: шкала из семи уровней с действиями и
    // сноской превращалась в слой почти во весь экран с собственной
    // внутренней прокруткой (см. dc/sheet-popover)
    <SheetPopover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setForm(null);
      }}
      title="Уровни падения"
      className="w-[352px]"
      trigger={
        <button
          type="button"
          aria-label={`Уровни падения: ${position.title}`}
          title="Уровни падения от точки отсчёта"
          className={cn(
            // Тот же контрол, что и кнопка разметки (дизайн-код §5): в шапке
            // карточки они стоят рядом и обязаны читаться одинаково
            "flex h-[30px] shrink-0 items-center gap-1.5 rounded-control border border-line-card px-2 outline-none transition-colors duration-120 ease-out pointer-coarse:h-11 pointer-coarse:px-3 hover:border-line-hover hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50",
            reached ? "text-warn" : "text-text-3",
          )}
        >
          <TrendingDown className="size-3.5" />
          {view.changePercent !== null && (
            <span className="font-mono text-[12px] tabular-nums">
              {dcPp(view.changePercent, 1)}
            </span>
          )}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          {/* В нижнем листе заголовок уже стоит в его шапке */}
          <p className="t-h3 max-sm:hidden">Уровни падения</p>
          <p className="t-meta truncate text-text-3">
            {position.title}
            {view.marketSymbol ? ` · цена ${view.marketSymbol}` : ""}
          </p>
        </div>

        {!set ? (
          <>
            <NoEntryPrice />
            <ReferenceForm
              position={position}
              currentPrice={view.currentPriceUsd}
              levelsToHide={0}
              onSaved={async () => {
                await onJournalRefetch();
                setForm(null);
              }}
            />
          </>
        ) : (
          <>
            <Now view={view} />
            {form === "action" && current && (
              <ActionForm
                // Ключ по уровню: поля формы — начальные значения useState,
                // и без перемонтирования нажатие «отметить» на другой строке
                // шкалы оставило бы в селекторе прежний уровень, а операция
                // легла бы не туда. Черновик при этом теряется — так же, как
                // при закрытии поповера, и по той же причине
                key={actionLevel ?? "next"}
                position={position}
                pointId={current.id}
                currentPrice={view.currentPriceUsd}
                defaultLevel={actionLevel ?? view.nextLevel?.dropPercent ?? 7}
                onSaved={async () => {
                  await onJournalRefetch();
                  setForm(null);
                }}
              />
            )}
            {form === "reference" && (
              <ReferenceForm
                position={position}
                currentPrice={view.currentPriceUsd}
                // Со шкалы сходят УРОВНИ, а не операции: на −30 их по
                // стратегии три (продажа, откуп из выручки, покупка из
                // Stability), а отметка на шкале погаснет одна
                levelsToHide={
                  new Set(current?.actions.map((action) => action.dropPercent)).size
                }
                onSaved={async () => {
                  await onJournalRefetch();
                  setForm(null);
                }}
              />
            )}
            {form === null && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || current === null} onClick={() => { setActionLevel(view.nextLevel?.dropPercent ?? 7); setForm("action"); }}>
                  <Plus className="size-3.5" /> Отметить операцию
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setForm("reference")}>
                  Перенести точку
                </Button>
              </div>
            )}
            <Scale view={view} onAction={current ? (level) => { setActionLevel(level); setForm("action"); } : undefined} />
            {journal && <JournalHistory position={position} journal={journal} onChanged={onJournalRefetch} />}
            <Footer view={view} />
          </>
        )}
      </div>
    </SheetPopover>
  );
}

/** Без точки отсчёта шкалы нет — и подсказано, где её задать. */
function NoEntryPrice() {
  return (
    <p className="text-[12.5px] text-text-2">
      Точка отсчёта не задана, и уровни считать не от чего. Цена входа
      указывается в разметке позиции — кнопкой рядом.
    </p>
  );
}

function ReferenceForm({
  position,
  currentPrice,
  levelsToHide,
  onSaved,
}: {
  position: PositionDto;
  currentPrice: number | null;
  levelsToHide: number;
  onSaved: () => Promise<void>;
}) {
  const [price, setPrice] = useState(currentPrice === null ? "" : String(currentPrice));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState<"current_price" | "manual" | "chain">(
    currentPrice === null ? "manual" : "current_price",
  );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const priceUsd = Number(price);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return toast.error("Цена должна быть больше нуля");
    setSaving(true);
    try {
      const [protocol, chain, externalId] = position.zoneKey.split(":");
      await apiFetch("/api/positions/gm-journal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "reference", protocol, chain, externalId, priceUsd, source, note: note || null }),
      });
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Не удалось перенести точку");
    } finally { setSaving(false); }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-block border border-line bg-sunken p-3">
      <p className="text-[12.5px] text-text-2">
        {levelsToHide > 0
          ? `Новая точка начнёт чистый цикл: со шкалы ${plural(levelsToHide, "сойдёт", "сойдут", "сойдёт")} ${countLabel(levelsToHide, "уровень", "уровня", "уровней")}, но записи операций останутся в журнале.`
          : "Новая точка начнёт чистый цикл. История операций останется в журнале."}
      </p>
      <Input value={price} onChange={(event) => { setPrice(event.target.value); setSource("manual"); }} inputMode="decimal" placeholder="Цена базового актива, $" className="font-mono" />
      <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="Заметка (необязательно)" />
      <TransferSearch position={position} onPick={(row) => { if (row.assetPriceUsd !== null) { setPrice(String(row.assetPriceUsd)); setSource("chain"); } }} />
      <div className="flex justify-end gap-2"><Button type="submit" size="sm" disabled={saving}>Сохранить точку</Button></div>
    </form>
  );
}

function ActionForm({
  position,
  pointId,
  currentPrice,
  defaultLevel,
  action,
  onSaved,
}: {
  position: PositionDto;
  pointId: string;
  currentPrice: number | null;
  defaultLevel: number;
  action?: GmLevelActionDto;
  onSaved: () => Promise<void>;
}) {
  const [level, setLevel] = useState(String(action?.dropPercent ?? defaultLevel));
  const [kind, setKind] = useState<"sell" | "buy">(action?.kind ?? "sell");
  const [gmAmount, setGmAmount] = useState(action?.gmAmount ?? "");
  const [fundsSource, setFundsSource] = useState(action?.fundsSource ?? "proceeds");
  const [assetAmount, setAssetAmount] = useState(action?.assetAmount ?? "");
  const [usdAmount, setUsdAmount] = useState(action?.usdAmount ?? "");
  const [assetPriceUsd, setAssetPriceUsd] = useState(action?.assetPriceUsd === null || action === undefined ? (currentPrice === null ? "" : String(currentPrice)) : String(action.assetPriceUsd));
  const [happenedAt, setHappenedAt] = useState(localTimeDraft(action?.happenedAt));
  const [note, setNote] = useState(action?.note ?? "");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d+(?:\.\d+)?$/.test(gmAmount) || Number(gmAmount) <= 0) return toast.error("Укажите количество GM больше нуля");
    const optional = (value: string) => value.trim() === "" ? null : Number(value);
    const fields = [assetAmount, usdAmount, assetPriceUsd].map(optional);
    if (fields.some((value) => value !== null && (!Number.isFinite(value) || value < 0)) || (fields[2] !== null && fields[2] <= 0)) return toast.error("Необязательные суммы должны быть неотрицательными, а цена — больше нуля");
    const occurred = new Date(happenedAt);
    if (Number.isNaN(occurred.getTime()) || occurred.getTime() > Date.now() + 5 * 60_000) return toast.error("Укажите корректное время операции");
    setSaving(true);
    try {
      await apiFetch("/api/positions/gm-journal", {
        method: action ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: action ? "update-action" : "action", ...(action ? { id: action.id } : {}), referencePointId: action?.referencePointId ?? pointId, dropPercent: Number(level), kind, gmAmount,
          fundsSource: kind === "buy" ? fundsSource : null, assetAmount: fields[0], usdAmount: fields[1],
          assetPriceUsd: fields[2], happenedAt: occurred.toISOString(), note: note || null }),
      });
      await onSaved();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Не удалось сохранить операцию"); }
    finally { setSaving(false); }
  }
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-block border border-line bg-sunken p-3">
      <div className="flex gap-2"><select value={level} onChange={(event) => setLevel(event.target.value)} className="h-9 flex-1 rounded-control border border-line bg-surface px-2 text-[13px]"><option value="-50">+50%</option>{[7, 15, 30, 50, 70].map((value) => <option value={value} key={value}>−{value}%</option>)}</select><select value={kind} onChange={(event) => setKind(event.target.value as "sell" | "buy")} className="h-9 flex-1 rounded-control border border-line bg-surface px-2 text-[13px]"><option value="sell">Продажа GM</option><option value="buy">Покупка GM</option></select></div>
      <Input value={gmAmount} onChange={(event) => setGmAmount(event.target.value)} inputMode="decimal" placeholder="Количество GM *" className="font-mono" />
      {kind === "buy" && <select value={fundsSource} onChange={(event) => setFundsSource(event.target.value as "proceeds" | "stability" | "yield_reserve")} className="h-9 rounded-control border border-line bg-surface px-2 text-[13px]"><option value="proceeds">Выручка от GM</option><option value="stability">Stability (свои)</option><option value="yield_reserve">Резерв Yield (заёмные)</option></select>}
      <div className="grid grid-cols-2 gap-2"><Input value={assetAmount} onChange={(event) => setAssetAmount(event.target.value)} inputMode="decimal" placeholder="Базовый актив" className="font-mono" /><Input value={usdAmount} onChange={(event) => setUsdAmount(event.target.value)} inputMode="decimal" placeholder="Сумма, $" className="font-mono" /></div>
      <Input value={assetPriceUsd} onChange={(event) => setAssetPriceUsd(event.target.value)} inputMode="decimal" placeholder="Цена базового актива, $" className="font-mono" />
      <Input type="datetime-local" value={happenedAt} onChange={(event) => setHappenedAt(event.target.value)} />
      <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="Заметка (необязательно)" />
      <TransferSearch position={position} onPick={(row) => { setGmAmount(row.gmAmount); if (row.assetPriceUsd !== null) setAssetPriceUsd(String(row.assetPriceUsd)); }} />
      <div className="flex justify-end"><Button type="submit" size="sm" disabled={saving}>{action ? "Сохранить правку" : "Сохранить операцию"}</Button></div>
    </form>
  );
}

function TransferSearch({
  position,
  onPick,
}: {
  position: PositionDto;
  onPick: (row: GmTransfersResponseDto["rows"][number]) => void;
}) {
  const [result, setResult] = useState<GmTransfersResponseDto | null>(null);
  const [loading, setLoading] = useState(false);
  async function search() {
    const [, chain, externalId] = position.zoneKey.split(":");
    setLoading(true);
    try {
      setResult(await apiFetch<GmTransfersResponseDto>(`/api/positions/gm-transfers?chain=${encodeURIComponent(chain)}&externalId=${encodeURIComponent(externalId)}&walletId=${encodeURIComponent(position.walletId)}`));
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Не удалось найти операции GM"); }
    finally { setLoading(false); }
  }
  const message = result === null ? null : result.status === "empty"
    ? `За последние ${result.searchDays} дней операций с GM не найдено.`
    : result.status === "unsupported" ? "Провайдер не поддерживает поиск в этом окне; введите данные вручную."
    : result.status === "partial" ? "Поиск просмотрел только часть окна; показаны найденные операции."
    : result.status === "unavailable" ? "Опросить блокчейн не удалось; это не означает, что операций не было."
    : null;
  return (
    <div className="grid gap-1.5 border-line border-t pt-2">
      <Button type="button" size="sm" variant="ghost" onClick={() => void search()} disabled={loading}>{loading ? "Ищем…" : "Найти GM в блокчейне (14 дней)"}</Button>
      {message && <p className="text-[12px] text-text-3">{message}</p>}
      {result?.rows.map((row) => (
        <button key={row.key} type="button" onClick={() => onPick(row)} className="flex items-center justify-between gap-2 rounded-control px-1.5 py-1 text-left text-[12px] hover:bg-raised">
          <span>{tableDate(row.happenedAt ?? "")} · {row.kind === "buy" ? "покупка" : "продажа"} · {tableQuantity(row.gmAmount)} GM</span>
          <span className="font-mono text-text-3">{row.assetPriceUsd === null ? "цены нет" : dcUsd(row.assetPriceUsd)}</span>
        </button>
      ))}
      {result?.rows.some((row) => row.assetPriceUsd !== null) && <p className="text-[11px] text-text-3">Цена CoinGecko на момент покупки, не оракул GMX.</p>}
    </div>
  );
}

/** Две величины, из которых считается всё остальное. */
function Now({ view }: { view: GmLevelsView }) {
  return (
    <div className="flex items-stretch gap-px overflow-hidden rounded-block bg-line">
      <Cell label="Точка отсчёта" value={dcUsd(view.entryPriceUsd ?? 0)} />
      <Cell
        label="Цена сейчас"
        value={
          view.currentPriceUsd === null ? null : dcUsd(view.currentPriceUsd)
        }
        note={
          view.changePercent === null ? undefined : (
            <span
              className={cn(
                view.changePercent < 0 ? "text-loss" : "text-profit",
              )}
            >
              {dcPp(view.changePercent, 1)}
            </span>
          )
        }
      />
    </div>
  );
}

function Cell({
  label,
  value,
  note,
}: {
  label: string;
  value: string | null;
  note?: ReactNode;
}) {
  return (
    <div className="flex-1 bg-sunken px-3 py-2.5">
      <span className="t-label">{label}</span>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-[13.5px] tabular-nums">
          {value ?? <span className="text-text-3">—</span>}
        </span>
        {note && <span className="text-[12px]">{note}</span>}
      </p>
    </div>
  );
}

/**
 * Шкала: строки идут по убыванию цены, маркер «сейчас» вставляется в свой
 * промежуток. Порядок строк — это и есть ответ на вопрос «где мы».
 */
function Scale({
  view,
  onAction,
}: {
  view: GmLevelsView;
  onAction?: (level: number) => void;
}) {
  const entry = view.entryPriceUsd ?? 0;
  const rows: ScaleRow[] = [
    ...(view.growth
      ? [
          {
            key: "growth",
            priceUsd: view.growth.priceUsd,
            title: dcPp(view.growth.percent, 0),
            note: "ориентир первой фиксации: часть GM продают",
            reached: view.growth.reached,
            acted: view.growth.acted,
            actionLevel: GM_GROWTH_LEVEL_KEY,
            tone: "profit" as const,
          },
        ]
      : []),
    {
      key: "entry",
      priceUsd: entry,
      title: "вход",
      note: "точка отсчёта — цена базового актива на входе",
      reached: null,
      acted: false,
      tone: "entry" as const,
    },
    ...view.levels.map((l) => ({
      key: `d${l.dropPercent}`,
      priceUsd: l.priceUsd,
      title: dcPp(-l.dropPercent, 0),
      note: l.action,
      stability: l.stabilityAction,
      reached: l.reached,
      acted: l.acted,
      actionLevel: l.dropPercent,
      next: view.nextLevel?.dropPercent === l.dropPercent,
      tone: "drop" as const,
    })),
  ];

  // Маркер встаёт перед первой строкой, цену которой мы уже прошли вниз;
  // если цена ниже всей шкалы — в самый низ, если цены нет — не встаёт вовсе
  const price = view.currentPriceUsd;
  const above = price === null ? -1 : rows.findIndex((r) => price > r.priceUsd);
  const markerAt = price === null ? -1 : above === -1 ? rows.length : above;

  return (
    <ol className="flex flex-col">
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index === markerAt && <NowMarker view={view} />}
          <ScaleItem row={row} onAction={onAction} />
        </Fragment>
      ))}
      {markerAt === rows.length && <NowMarker view={view} />}
    </ol>
  );
}

interface ScaleRow {
  key: string;
  priceUsd: number;
  title: string;
  note: string;
  stability?: string | null;
  reached: boolean | null;
  acted: boolean;
  actionLevel?: number;
  next?: boolean;
  tone: "profit" | "entry" | "drop";
}

function ScaleItem({ row, onAction }: { row: ScaleRow; onAction?: (level: number) => void }) {
  const passed = row.reached === true;
  return (
    <li className="flex gap-2.5 py-1.5">
      <span
        aria-hidden
        className={cn(
          "mt-[7px] size-[7px] shrink-0 rounded-full",
          passed && row.tone === "drop" && "bg-warn",
          passed && row.tone === "profit" && "bg-profit",
          !passed && row.tone === "entry" && "bg-text-3",
          !passed && row.tone !== "entry" && "bg-line-strong",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "font-mono text-[13px] tabular-nums",
                passed ? "text-text-1" : "text-text-2",
              )}
            >
              {row.title}
            </span>
            {passed && row.tone === "drop" && (
              <StatusChip tone="warn">пройден</StatusChip>
            )}
            {passed && row.tone === "profit" && (
              <StatusChip tone="profit">достигнут</StatusChip>
            )}
            {row.acted && <Chip>отработан</Chip>}
            {row.next && <Chip>ближайший</Chip>}
          </span>
          <span className="font-mono text-[12px] tabular-nums text-text-3">
            {dcUsd(row.priceUsd)}
          </span>
        </div>
        <p className="text-[12px] text-text-3">{row.note}</p>
        {row.stability && (
          <p className="text-[12px] text-text-3">
            Stability: {row.stability}
          </p>
        )}
        {row.actionLevel !== undefined && onAction && (
          <button type="button" onClick={() => onAction(row.actionLevel as number)} className="mt-1 text-[12px] text-link underline-offset-4 hover:underline">
            Отметить операцию на этом уровне
          </button>
        )}
      </div>
    </li>
  );
}

/** «Сейчас» — линия между строками шкалы, а не ещё один её уровень. */
function NowMarker({ view }: { view: GmLevelsView }) {
  return (
    <li className="flex items-center gap-2.5 py-1">
      <span
        aria-hidden
        className="h-[15px] w-[2px] shrink-0 rounded-[1px] bg-primary"
      />
      <span className="flex flex-1 items-baseline justify-between gap-2 text-[12px]">
        <span className="font-medium text-primary">
          сейчас
          {view.changePercent === null
            ? ""
            : ` · ${dcPp(view.changePercent, 1)}`}
        </span>
        <span className="font-mono tabular-nums text-text-2">
          {view.currentPriceUsd === null ? "—" : dcUsd(view.currentPriceUsd)}
        </span>
      </span>
    </li>
  );
}

function Footer({ view }: { view: GmLevelsView }) {
  return (
    <div className="flex flex-col gap-1.5 border-line border-t pt-2.5">
      <p className="text-[12.5px] text-text-2">{verdict(view)}</p>
      <p className="text-[12px] text-text-3">
        Цена сейчас и отработанность не смешиваются: цену показывает оракул,
        операцию отмечаете вы. Перед действием по уровню цена должна
        закрепиться — правило 48 часов.
      </p>
    </div>
  );
}

/** Утверждение, а не инструкция (дизайн-код §7). */
function verdict(view: GmLevelsView): string {
  if (view.currentPriceUsd === null) {
    return "Цена базового актива не прочитана — где стоит цена относительно уровней, не видно.";
  }
  if (view.nextLevel === null) {
    // «Уровня для действия не осталось» теперь имеет две причины, и они
    // требуют разных решений: цена ушла ниже всей шкалы — или уровни
    // отработаны и ждут переноса точки. Один текст на оба случая
    // противоречил бы счётчику пройденных на том же экране
    const acted = view.levels.filter((level) => level.acted).length;
    if (acted === view.levels.length && acted > 0) {
      return "Все уровни цикла отработаны: следующее действие — после переноса точки отсчёта.";
    }
    if (acted > 0) {
      return `Уровней для действия не осталось: по журналу отработано ${acted} из ${view.levels.length}, остальные пройдены ценой.`;
    }
    return "Пройдены все уровни падения: глубже шкала действий стратегии не идёт.";
  }
  // «Осталось упасть» — величина от сегодняшней цены, поэтому обычный
  // процент, а не отклонение со знаком: знак уже сказан словом «упасть».
  // Действие уровня здесь не повторяется — оно стоит строкой шкалы
  const next = `ближайший ${dcPp(-view.nextLevel.dropPercent, 0)}, до него цене осталось упасть на ${tablePct(view.toNextPercent ?? 0, 1)}.`;
  return view.lastReached === null
    ? `Пройденных уровней нет: ${next}`
    : `Пройден уровень ${dcPp(-view.lastReached.dropPercent, 0)}, ${next}`;
}

function JournalHistory({
  position,
  journal,
  onChanged,
}: {
  position: PositionDto;
  journal: GmJournalDto;
  onChanged: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<GmLevelActionDto | null>(null);
  async function removeAction(action: GmLevelActionDto) {
    setDeleting(action.id);
    try {
      await apiFetch(`/api/positions/gm-journal?kind=action&id=${action.id}`, { method: "DELETE" });
      await onChanged();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Не удалось удалить операцию"); }
    finally { setDeleting(null); }
  }
  async function removePoint(id: string) {
    // Предыдущего цикла может не быть — тогда возвращаться некуда, и
    // триггер обнулит цену входа: шкала исчезнет целиком. Обещать здесь
    // «предыдущий цикл станет текущим» значило бы обещать несуществующее
    const last = journal.points.length === 1;
    const question = last
      ? "Это единственная точка отсчёта. После удаления цена входа станет незаданной и шкала уровней пропадёт. Удалить?"
      : "Удалить последнюю точку отсчёта? Предыдущий цикл снова станет текущим.";
    if (!window.confirm(question)) return;
    setDeleting(id);
    try {
      await apiFetch(`/api/positions/gm-journal?kind=reference&id=${id}`, { method: "DELETE" });
      await onChanged();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : "Не удалось удалить точку"); }
    finally { setDeleting(null); }
  }
  return (
    <section className="grid gap-2 border-line border-t pt-3">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-2"><History className="size-3.5" /> Журнал операций</p>
      {journal.points.map((point, pointIndex) => (
        <div key={point.id} className="rounded-block border border-line bg-sunken p-2.5">
          <div className="flex items-start justify-between gap-2"><p className="text-[12px] text-text-2">
            {pointIndex === 0 ? "Текущий цикл" : "Прошлый цикл"} · {dcUsd(point.priceUsd)}
            {point.setAt ? ` · ${tableDate(point.setAt)}` : " · дата неизвестна"}
          </p>{pointIndex === 0 && <button type="button" disabled={deleting === point.id} onClick={() => void removePoint(point.id)} className="shrink-0 text-[12px] text-link underline-offset-4 hover:underline">отменить точку</button>}</div>
          {point.actions.length === 0 ? <p className="mt-1 text-[12px] text-text-3">Операций нет.</p> : (
            <ul className="mt-1 grid gap-1">
              {point.actions.map((action) => (
                <li key={action.id} className="flex items-start justify-between gap-2 text-[12px] text-text-2">
                  <span>{tableDate(action.happenedAt)} · {action.kind === "sell" ? "продажа" : "покупка"} · {tableQuantity(action.gmAmount)} GM · {action.dropPercent === -50 ? "+50%" : `−${action.dropPercent}%`}{action.assetPriceUsd === null ? "" : ` · ${dcUsd(action.assetPriceUsd)}`}</span>
                  <span className="flex shrink-0 gap-2"><button type="button" onClick={() => setEditing(action)} className="text-link underline-offset-4 hover:underline">править</button><button type="button" disabled={deleting === action.id} onClick={() => void removeAction(action)} className="text-link underline-offset-4 hover:underline">удалить</button></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {/* Ключ по id операции обязателен: без него переключение «править»
          с одной строки на другую оставляет в полях значения первой, а
          сохранение уходит по id второй — и количество GM, которого нет
          больше нигде, затирается чужим */}
      {editing && <ActionForm key={editing.id} position={position} pointId={editing.referencePointId} currentPrice={null} defaultLevel={editing.dropPercent} action={editing} onSaved={async () => { await onChanged(); setEditing(null); }} />}
    </section>
  );
}

function localTimeDraft(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
