/**
 * Раскрывающийся блок: единственная разрешённая анимация помимо цветовых
 * переходов — раскрытие .16s ease-out (дизайн-код §8).
 *
 * Высота едет через grid-template-rows 0fr → 1fr: блоку не нужно знать свою
 * высоту заранее. Стартовое состояние задаёт @starting-style (`starting:`),
 * поэтому раскрытие работает на монтировании и без состояния и эффектов.
 * Закрытая форма не смонтирована: она не держит значения полей и не
 * участвует в табуляции.
 */
export function Collapse({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-[160ms] ease-out starting:grid-rows-[0fr] starting:opacity-0">
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
