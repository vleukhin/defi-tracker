import { ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Обязательное уведомление безопасности (ТЗ S1.2, дизайн §5.2):
 * приложение работает только на чтение — никаких приватных ключей и сид-фраз,
 * ни одно поле не должно их запрашивать.
 */
export function ReadOnlyNotice() {
  return (
    <Alert variant="success" role="note">
      <ShieldCheck className="size-4" />
      <AlertTitle>Только просмотр.</AlertTitle>
      <AlertDescription>
        Приложение не может распоряжаться средствами.
      </AlertDescription>
    </Alert>
  );
}
