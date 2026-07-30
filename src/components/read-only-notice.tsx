/**
 * Обязательное уведомление безопасности (ТЗ S1.2):
 * приложение работает только на чтение — никаких приватных ключей и сид-фраз,
 * ни одно поле не должно их запрашивать.
 */
export function ReadOnlyNotice() {
  return (
    <div
      role="note"
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
    >
      <span className="font-medium">Только просмотр.</span>{" "}
      Приложение не может распоряжаться средствами.
    </div>
  );
}
