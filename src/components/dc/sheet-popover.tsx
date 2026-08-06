"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Поповер на десктопе, нижний лист на телефоне — одно содержимое и одно
 * состояние открытия.
 *
 * Зачем лист. Оба поповера карточки позиции (разметка и шкала уровней) —
 * это высокие формы и таблицы. В слое, привязанном к 30-пиксельному
 * триггеру, они превращались в прямоугольник почти во весь экран с
 * собственной внутренней прокруткой поверх прокрутки страницы, а форма
 * разметки с четырьмя полями ещё и соперничала с экранной клавиатурой,
 * потому что стояла у верхнего края.
 *
 * Переключение по медиазапросу, а не по CSS: Radix проставляет позицию
 * поповеру инлайновыми стилями, и перебить их классами надёжно нельзя.
 * До первого измерения рисуется десктопная ветка — на сервере окна нет,
 * а расхождение гидрации здесь безопасно: до открытия слой не виден.
 */

/** Ниже этой ширины поповер превращается в лист. Совпадает с `sm` Tailwind. */
const SHEET_QUERY = "(max-width: 639px)";

function useIsSheet(): boolean {
  const [isSheet, setIsSheet] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(SHEET_QUERY);
    const apply = () => setIsSheet(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return isSheet;
}

export function SheetPopover({
  trigger,
  title,
  children,
  open,
  onOpenChange,
  align = "end",
  className,
}: {
  trigger: React.ReactNode;
  /** Заголовок листа: у диалога он обязателен, поповеру не показывается. */
  title: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  /** Ширина содержимого на десктопе. */
  className?: string;
}) {
  const isSheet = useIsSheet();

  if (!isSheet) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align={align} className={className}>
          {children}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 duration-120 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Content
          // Описание не задаётся: содержимое — форма или таблица, и Radix
          // иначе предупреждает об отсутствующем aria-describedby
          aria-describedby={undefined}
          className={cn(
            // 85dvh, а не vh: на мобиле адресная строка съедает часть vh,
            // и лист уезжал бы под неё нижним краем
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-card border-line-strong border-t bg-raised shadow-(--shadow-pop) duration-150 outline-none data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-line border-b py-2 pr-2 pl-4">
            <Dialog.Title className="t-h3">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Закрыть">
                <X className="size-5" />
              </Button>
            </Dialog.Close>
          </div>

          {/* Отступ снизу считается от выреза: последняя строка формы иначе
              уходит под home-indicator */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
