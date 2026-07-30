import { cn } from "@/lib/utils";

/**
 * Логомарк «Terminal Blue» (ТЗ §4.4): три вертикальные скругленные полоски
 * категорийных цветов — эхо полосы аллокации (BTC / ETH / Stablecoins),
 * высоты 16/10/13 из 16. Инлайн-SVG, без файлов-ассетов.
 * size="sm" — навигация (16px), size="lg" — auth-экраны (24px).
 */
export function LogoMark({
  size = "sm",
  className,
}: {
  size?: "sm" | "lg";
  className?: string;
}) {
  const px = size === "lg" ? 24 : 16;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      {/* Полоски прижаты к низу — мотив стековой полосы аллокации */}
      <rect x="0" y="0" width="4" height="16" rx="2" className="fill-chart-btc" />
      <rect x="6" y="6" width="4" height="10" rx="2" className="fill-chart-eth" />
      <rect x="12" y="3" width="4" height="13" rx="2" className="fill-chart-stable" />
    </svg>
  );
}

export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={size} />
      {size === "lg" ? (
        <span className="text-lg font-semibold tracking-tight">
          DeFi Portfolio Tracker
        </span>
      ) : (
        <span className="text-sm font-semibold tracking-tight">
          DeFi Portfolio
        </span>
      )}
    </span>
  );
}
