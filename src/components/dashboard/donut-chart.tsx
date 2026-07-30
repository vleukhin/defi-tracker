import { formatPct, formatUsd } from "@/lib/format";
import type { BucketAllocationDto } from "@/lib/api/types";

/**
 * Донат-чарт текущей аллокации (S1.7) — инлайн-SVG без библиотек.
 * Цвета закреплены за корзинами стабильно (сортировка по bucketId),
 * чтобы не «прыгали» между обновлениями. Легенда дублирует данные
 * текстом — цвет не единственный носитель информации.
 */

const PALETTE = [
  "#2563eb", // blue-600
  "#f59e0b", // amber-500
  "#059669", // emerald-600
  "#7c3aed", // violet-600
  "#dc2626", // red-600
  "#0891b2", // cyan-600
  "#c026d3", // fuchsia-600
  "#65a30d", // lime-600
  "#ea580c", // orange-600
  "#475569", // slate-600
];

/** Стабильное соответствие корзина -> цвет: индекс в отсортированных id. */
export function bucketColors(bucketIds: string[]): Map<string, string> {
  const sorted = [...bucketIds].sort();
  return new Map(sorted.map((id, i) => [id, PALETTE[i % PALETTE.length]]));
}

interface DonutChartProps {
  buckets: BucketAllocationDto[];
  totalUsd: number;
}

export function DonutChart({ buckets, totalUsd }: DonutChartProps) {
  const slices = buckets.filter((b) => b.valueUsd > 0);
  if (slices.length === 0 || totalUsd <= 0) return null;

  const colors = bucketColors(slices.map((s) => s.bucketId));
  const R = 70;
  const C = 2 * Math.PI * R;

  const description = slices
    .map((s) => `${s.name} ${formatPct(s.currentPct)}`)
    .join(", ");

  const totalLabel = formatUsd(totalUsd, 0);
  const totalFontSize = totalLabel.length > 9 ? 15 : 19;

  // Предрасчет дуг: длина и стартовое смещение каждого сегмента
  const arcs: { bucket: BucketAllocationDto; len: number; start: number }[] =
    [];
  let acc = 0;
  for (const s of slices) {
    const len = (s.currentPct / 100) * C;
    arcs.push({ bucket: s, len, start: acc });
    acc += len;
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg
        viewBox="0 0 200 200"
        className="h-44 w-44 shrink-0"
        role="img"
        aria-label={`Аллокация по корзинам: ${description}`}
      >
        <g transform="rotate(-90 100 100)">
          {arcs.map(({ bucket, len, start }) => (
            <circle
              key={bucket.bucketId}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={colors.get(bucket.bucketId)}
              strokeWidth="30"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-start}
            />
          ))}
        </g>
        <text
          x="100"
          y="96"
          textAnchor="middle"
          fontSize={totalFontSize}
          fontWeight="600"
          fill="#111827"
        >
          {totalLabel}
        </text>
        <text x="100" y="116" textAnchor="middle" fontSize="11" fill="#6b7280">
          всего
        </text>
      </svg>

      <ul className="w-full space-y-1.5 text-sm" aria-hidden="true">
        {slices.map((s) => (
          <li key={s.bucketId} className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: colors.get(s.bucketId) }}
            />
            <span className="min-w-0 flex-1 truncate text-gray-700">
              {s.name}
            </span>
            <span className="tabular-nums font-medium text-gray-900">
              {formatPct(s.currentPct)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
