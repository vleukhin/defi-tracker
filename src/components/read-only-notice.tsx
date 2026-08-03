import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Обязательное уведомление безопасности (ТЗ S1.2, дизайн §5.2):
 * приложение работает только на чтение — никаких приватных ключей и сид-фраз,
 * ни одно поле не должно их запрашивать.
 *
 * Дизайн-код: это не баннер во всю ширину. Зелёная заливка Alert'а нарушала
 * бы §2 (семантика — только числа P/L и статусы риска), поэтому уведомление
 * живёт компактной мета-строкой рядом с заголовком страницы.
 */
export function ReadOnlyNotice({ className }: { className?: string }) {
  return (
    <p
      role="note"
      className={cn("t-meta flex items-start gap-2 text-text-2", className)}
    >
      <ShieldCheck
        aria-hidden
        className="mt-[2px] size-3.5 shrink-0 text-text-3"
      />
      <span>
        Только просмотр: приложение не может распоряжаться средствами и не
        спрашивает приватных ключей и сид-фраз.
      </span>
    </p>
  );
}
