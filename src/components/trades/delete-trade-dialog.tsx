"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { TradeDto } from "@/lib/api/types";
import { tableDate } from "@/lib/format";
import { ApiError, apiFetch } from "@/lib/use-api";

/**
 * Удаление сделки. Живёт в раскрытой форме правки, а не в строке таблицы:
 * в строке остаётся одно действие — «правка» (README, п.4), а разрушающее
 * действие лежит там же, где пользователь уже разглядывает саму сделку.
 */
export function DeleteTradeDialog({
  trade,
  onDeleted,
}: {
  trade: TradeDto;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiFetch(`/api/trades/${trade.id}`, { method: "DELETE" });
      toast.success("Сделка удалена");
      onDeleted();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Не удалось удалить сделку",
      );
      setDeleting(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={deleting}
          aria-label={`Удалить сделку от ${tableDate(trade.tradedAt)}`}
        >
          Удалить
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить сделку?</AlertDialogTitle>
          <AlertDialogDescription>
            Средняя цена и P/L будут пересчитаны.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void handleDelete()}
          >
            Удалить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
