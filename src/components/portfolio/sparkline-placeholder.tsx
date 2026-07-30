import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/**
 * Заготовка спарклайна до Фазы 3 (ТЗ §5.1.5): честно пустая —
 * никаких фейковых данных, осей и градиентных заливок. Когда появятся
 * снепшоты, здесь будет линия стоимости за 30 дней.
 */
export function SparklinePlaceholder() {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Динамика стоимости</h2>
        <Badge variant="muted">Фаза 3</Badge>
      </div>
      <div className="relative mt-2 flex h-[72px] items-center sm:h-24">
        <div className="w-full border-t border-dashed border-border" />
        <p className="absolute left-1/2 -translate-x-1/2 bg-card px-2 text-center text-xs text-muted-foreground">
          График появится после первых снепшотов
        </p>
      </div>
    </Card>
  );
}
