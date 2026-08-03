import { cn } from "@/lib/utils";

/**
 * Знак продукта (README, «Assets»): три полосы возрастающей высоты цветами
 * зон Growth / Yield / Stability. Знак говорит про зоны, а не про категории:
 * зоны — то, как стратегия делит капитал по задачам, и это её главный разрез.
 *
 * Вариант «в плитке» — 24–30px, radius 7–9, на --bg-chip с обводкой.
 */
export function LogoMark({
  size = "sm",
  className,
}: {
  size?: "sm" | "lg";
  className?: string;
}) {
  const box = size === "lg" ? 30 : 24;
  const scale = box / 24;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-end rounded-[7px] border border-line-strong bg-chip",
        className,
      )}
      style={{
        width: box,
        height: box,
        gap: 2.5 * scale,
        padding: `${4 * scale}px ${4 * scale}px ${5 * scale}px`,
      }}
    >
      <span
        className="rounded-[1px] bg-[var(--zone-growth)]"
        style={{ width: 3 * scale, height: 6 * scale }}
      />
      <span
        className="rounded-[1px] bg-[var(--zone-yield)]"
        style={{ width: 3 * scale, height: 10 * scale }}
      />
      <span
        className="rounded-[1px] bg-[var(--zone-stability)]"
        style={{ width: 3 * scale, height: 14 * scale }}
      />
    </span>
  );
}

/**
 * Имя продукта: «DeFi» основным цветом, «Portfolio» — --text-3 весом 450.
 * Два начертания одного шрифта, а не два шрифта: дизайн-код запрещает
 * больше двух начертаний на экране, и они уже потрачены.
 */
export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span
        className={cn(
          "font-semibold tracking-[-0.01em]",
          size === "lg" ? "text-[17px]" : "text-[14.5px]",
        )}
      >
        DeFi
        <span className="font-[450] text-text-3"> Portfolio</span>
      </span>
    </span>
  );
}
