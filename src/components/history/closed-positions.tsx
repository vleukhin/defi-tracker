"use client";

import { useState } from "react";
import { DcCard, Disclaimer, EmptyState, SectionHead } from "@/components/dc/card";
import { ZoneChip } from "@/components/dc/chip";
import { HelpTip } from "@/components/dc/help-tip";
import { ProtocolMark } from "@/components/dc/protocol-icons";
import { Dash, DcTable, Td, Th, Tr } from "@/components/dc/table";
import { Pagination } from "@/components/pagination";
import { Button } from "@/components/ui/button";
import type {
  ClosedPositionDto,
  ClosedPositionsResponseDto,
  SnapshotPeriod,
} from "@/lib/api/types";
import { chainLabel, dcDelta, dcUsd, dcUsdSigned, tableDate } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

/**
 * Архив закрытых позиций (переключатель «Истории»).
 *
 * Запись создаёт обновление в момент, когда позиция исчезла из успешного
 * чтения цепочки, — поэтому здесь нет ни кнопки «закрыть», ни формы правки:
 * экран только читает. Главное, что он обязан сказать прямо, — что
 * «последняя стоимость» это ПОКАЗАНИЕ, а не выручка от выхода, и что итог
 * поэтому оценка. Выдать одно за другое значило бы соврать в единственном
 * месте, где этот итог вообще записан.
 *
 * Своё обращение к API, а не данные сверху: сборка монтируется только
 * в своём режиме, и открытие «Истории» за ними не ходит.
 */

const LAST_VALUE_HINT =
  "Стоимость позиции в последнем успешном чтении перед тем, как она исчезла " +
  "с цепочки. Это не выручка от выхода: сумму сделки приложение не видит, " +
  "оно видит отсутствие баланса.";

const PRINCIPAL_HINT =
  "Вложенное из разметки позиции на момент закрытия — своё плюс заёмное. " +
  "Прочерк означает, что размечено не полностью, и это не ноль.";

const WITHDRAWN_HINT =
  "Сколько было выведено из позиции по стоимости на момент вывода. Продажа " +
  "части GM с переводом BTC и ETH в залог — это переезд капитала, а не убыток.";

const PROFIT_HINT =
  "Последняя стоимость плюс выведенное минус вложенное. Оценка, а не факт: " +
  "вместо фактической выручки взято последнее показание. Прочерк означает, " +
  "что вложенное размечено не полностью, и доход неизвестен, а не равен нулю.";

const SECTION_HINT =
  "Позиции, которых больше нет на цепочке. Запись создаётся автоматически " +
  "при обновлении — только по сетям, которые ответили: отказ RPC закрытием " +
  "не считается.";

const FOOTNOTE =
  "Запись появляется сама, когда позиция исчезает с цепочки при очередном " +
  "обновлении. Момент закрытия на цепочке приложению неизвестен — известен " +
  "момент, когда исчезновение замечено.";

/** Закрытий за год десятки, а не сотни, но страница всё равно нужна. */
const PAGE_SIZE = 20;

/** Вложенное известно только когда размечены обе половины (как у живых позиций). */
function principalOf(closed: ClosedPositionDto): number | null {
  const { ownPrincipalUsd: own, borrowedPrincipalUsd: borrowed } = closed;
  return own !== null && borrowed !== null ? own + borrowed : null;
}

export function ClosedPositions({
  period,
  periodLabel,
  onShowAll,
}: {
  period: SnapshotPeriod;
  /** Развёрнутое название периода — для подписи пустого состояния. */
  periodLabel: string;
  onShowAll: () => void;
}) {
  const { data, error, loading, refetch } = useApi<ClosedPositionsResponseDto>(
    `/api/positions/closed?period=${period}`,
  );
  const [page, setPage] = useState(1);
  // Смена периода возвращает список на первую страницу: третья страница
  // другой выборки — это не то место, где владелец остановился
  const [shownPeriod, setShownPeriod] = useState(period);
  if (shownPeriod !== period) {
    setShownPeriod(period);
    setPage(1);
  }

  if (loading && data === null) return <ClosedSkeleton />;

  if (error !== null && data === null) {
    return (
      <DcCard as="section">
        <div className="flex flex-wrap items-center justify-between gap-3 px-card py-4">
          <p className="t-body text-text-2">
            Не удалось загрузить закрытые позиции: {error}
          </p>
          <Button variant="outline" onClick={() => void refetch()}>
            Повторить
          </Button>
        </div>
      </DcCard>
    );
  }

  const all = data?.closed ?? [];

  if (all.length === 0) {
    return (
      <DcCard as="section">
        <EmptyState
          title={
            period === "all"
              ? "Закрытых позиций пока нет"
              : `За ${periodLabel} закрытых позиций нет`
          }
          action={
            period === "all" ? (
              <p className="t-meta max-w-md text-text-3">{FOOTNOTE}</p>
            ) : (
              <Button variant="outline" onClick={onShowAll}>
                Показать всё время
              </Button>
            )
          }
        />
      </DcCard>
    );
  }

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <DcCard as="section">
        <SectionHead
          title="Закрытые позиции"
          count={all.length}
          hint={SECTION_HINT}
          className="border-line border-b"
        />

        {/* На телефоне восемь колонок становятся карточками (дизайн-код §6):
            горизонтальный скролл тут не выручает — сравнивать закрытия между
            собой нужно реже, чем прочитать одно целиком */}
        <ul className="divide-y divide-line sm:hidden">
          {rows.map((closed) => (
            <ClosedRowCard key={closed.id} closed={closed} />
          ))}
        </ul>

        <div className="hidden sm:block">
          <DcTable minWidth={960}>
            <thead>
              <tr>
                <Th>Закрыта</Th>
                <Th>Позиция</Th>
                <Th>Сеть</Th>
                <Th>Зона</Th>
                <Th numeric>
                  <HeadWithHint hint={LAST_VALUE_HINT}>
                    Последняя стоимость
                  </HeadWithHint>
                </Th>
                <Th numeric>
                  <HeadWithHint hint={PRINCIPAL_HINT}>Вложено</HeadWithHint>
                </Th>
                <Th numeric>
                  <HeadWithHint hint={WITHDRAWN_HINT}>Выведено</HeadWithHint>
                </Th>
                <Th numeric>
                  <HeadWithHint hint={PROFIT_HINT}>Итог</HeadWithHint>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((closed) => {
                const principal = principalOf(closed);
                return (
                  <Tr key={closed.id}>
                    <Td muted>{tableDate(closed.closedAt)}</Td>
                    <Td>
                      <PositionCell closed={closed} />
                    </Td>
                    <Td muted>{chainLabel(closed.chain)}</Td>
                    <Td>
                      <ZoneCell closed={closed} />
                    </Td>
                    <Td numeric mono>
                      {closed.lastValueUsd === null ? (
                        <Dash />
                      ) : (
                        dcUsd(closed.lastValueUsd)
                      )}
                    </Td>
                    <Td numeric>
                      {principal === null ? (
                        <Dash />
                      ) : (
                        <span className="flex flex-col items-end gap-0.5">
                          <span className="font-mono">{dcUsd(principal)}</span>
                          <span className="t-meta text-text-3">
                            своих {dcUsd(closed.ownPrincipalUsd ?? 0)}
                          </span>
                        </span>
                      )}
                    </Td>
                    <Td numeric mono>
                      {closed.withdrawnUsd === null ? (
                        <Dash />
                      ) : (
                        dcUsd(closed.withdrawnUsd)
                      )}
                    </Td>
                    <Td numeric>
                      <ProfitValue closed={closed} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DcTable>
        </div>

        <div className="border-line border-t bg-sunken px-card py-3">
          <Pagination
            page={safePage}
            pageSize={PAGE_SIZE}
            total={all.length}
            totalPages={totalPages}
            onPage={setPage}
          />
        </div>
      </DcCard>

      <Disclaimer>{FOOTNOTE}</Disclaimer>
    </div>
  );
}

/**
 * Зона с пометкой умолчания. Пометка обязательна: без неё решение владельца
 * («эта позиция — Stability») выглядит ровно как решение приложения.
 */
function ZoneCell({ closed }: { closed: ClosedPositionDto }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <ZoneChip zone={closed.zone} />
      {closed.zoneAssumed && (
        <HelpTip label="Зона не была размечена">
          Зона в разметке не была задана — показано умолчание протокола,
          а не ваш выбор.
        </HelpTip>
      )}
    </span>
  );
}

/** Заголовок колонки с «?»: объяснения живут только в тултипе (§1.3). */
function HeadWithHint({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint: string;
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {children}
      <HelpTip>{hint}</HelpTip>
    </span>
  );
}

/** Плитка протокола, название и подзаголовок — тот же каркас, что у живой карточки. */
function PositionCell({ closed }: { closed: ClosedPositionDto }) {
  return (
    <span className="flex items-center gap-2.5">
      <ProtocolMark protocol={closed.protocol} size={28} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{closed.title}</span>
        {closed.subtitle !== null && (
          <span className="t-meta truncate text-text-3">{closed.subtitle}</span>
        )}
      </span>
    </span>
  );
}

/**
 * Итог: цвет несёт только знак результата (дизайн-код §2 — зелёный и красный
 * бывают лишь у P/L). Прочерк — вложенное размечено не полностью.
 */
function ProfitValue({ closed }: { closed: ClosedPositionDto }) {
  if (closed.profitUsd === null) return <Dash />;
  const positive = closed.profitUsd >= 0;
  return (
    <span
      className={cn("font-mono", positive ? "text-profit" : "text-loss")}
    >
      {closed.profitPct === null
        ? dcUsdSigned(closed.profitUsd)
        : dcDelta(closed.profitUsd, closed.profitPct)}
    </span>
  );
}

/** Строка списка на телефоне: та же информация в четырёх метриках. */
function ClosedRowCard({ closed }: { closed: ClosedPositionDto }) {
  const principal = principalOf(closed);
  return (
    <li className="flex flex-col gap-3 px-card py-3.5">
      <div className="flex items-start justify-between gap-3">
        <PositionCell closed={closed} />
        <ZoneCell closed={closed} />
      </div>

      <p className="t-meta flex flex-wrap items-center gap-x-1.5 text-text-3">
        <span>закрыта {tableDate(closed.closedAt)}</span>
        <span aria-hidden className="text-text-4">
          ·
        </span>
        <span>{chainLabel(closed.chain)}</span>
      </p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Cell label="Последняя стоимость" hint={LAST_VALUE_HINT}>
          {closed.lastValueUsd === null ? <Dash /> : dcUsd(closed.lastValueUsd)}
        </Cell>
        <Cell label="Итог" hint={PROFIT_HINT}>
          <ProfitValue closed={closed} />
        </Cell>
        <Cell
          label="Вложено"
          hint={PRINCIPAL_HINT}
          // Доля своих не теряется на телефоне: по стратегии свои стейблы
          // всегда внутри позиций, и «сколько из этого было моим» —
          // не менее важный вопрос, чем общая сумма
          note={
            principal === null
              ? null
              : `своих ${dcUsd(closed.ownPrincipalUsd ?? 0)}`
          }
        >
          {principal === null ? <Dash /> : dcUsd(principal)}
        </Cell>
        <Cell label="Выведено" hint={WITHDRAWN_HINT}>
          {closed.withdrawnUsd === null ? <Dash /> : dcUsd(closed.withdrawnUsd)}
        </Cell>
      </dl>
    </li>
  );
}

function Cell({
  label,
  hint,
  note,
  children,
}: {
  label: string;
  hint: string;
  /** Вторая строка под значением — уточнение, а не второе значение. */
  note?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      {/* Подпись набирается в строку, а не флексом: «Последняя стоимость»
          переносится на две строки, и «?» во флексе уезжал к правому краю,
          отрываясь от последнего слова */}
      <dt className="t-label text-text-3">
        {label}{" "}
        <HelpTip label={`Пояснение: ${label}`} className="align-middle">
          {hint}
        </HelpTip>
      </dt>
      <dd className="mt-1 font-mono text-[14px]">{children}</dd>
      {note != null && <dd className="t-meta text-text-3">{note}</dd>}
    </div>
  );
}

/** Полосы --bg-chip размерами конечных строк — как у HistorySkeleton. */
function ClosedSkeleton() {
  return (
    <DcCard as="section" className="animate-none">
      <div aria-hidden className="flex flex-col">
        <div className="flex items-center gap-2 border-line border-b px-card py-3.5">
          <span className="block h-5 w-44 rounded-pill bg-chip" />
          <span className="block h-3 w-8 rounded-pill bg-chip" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 border-line border-b px-card py-3.5 last:border-0"
          >
            <span className="block h-7 w-7 shrink-0 rounded-[10px] bg-chip" />
            <span className="block h-3.5 w-full max-w-40 rounded-pill bg-chip" />
            <span className="block h-3.5 w-20 shrink-0 rounded-pill bg-chip" />
            <span className="block h-3.5 w-24 shrink-0 rounded-pill bg-chip" />
          </div>
        ))}
      </div>
    </DcCard>
  );
}
