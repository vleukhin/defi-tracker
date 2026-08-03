import type { ReactNode } from "react";
import { HelpTip } from "@/components/dc/help-tip";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Строка настройки: подпись в колонке 220px, контрол справа (README §9).
 * Методика — под «?», в поток она не попадает; на узких ширинах колонки
 * складываются в две строки, hit-зона контрола остаётся 34px.
 */
export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  /** Одно-два предложения в тултип — не абзац в интерфейсе. */
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const text = <span className="text-[13.5px] text-text-2">{label}</span>;
  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-card py-[15px] sm:flex-row sm:items-center sm:gap-5",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5 sm:w-[220px]">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="font-normal">
            {text}
          </Label>
        ) : (
          text
        )}
        {hint && <HelpTip>{hint}</HelpTip>}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
        {children}
      </div>
    </div>
  );
}
