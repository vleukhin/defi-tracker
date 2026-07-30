/**
 * Футер на всех страницах (ТЗ §5.6.4). Атрибуция CoinGecko обязательна
 * по условиям API (ТЗ S1.4). pb-20 на мобильных — чтобы нижняя навигация
 * не перекрывала текст; «·» на мобильных заменяется переносом строки.
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-transparent px-4 py-3 pb-20 text-center text-xs text-muted-foreground sm:pb-3">
      <span className="block sm:inline">
        Расчеты, а не финансовые советы
      </span>
      <span className="hidden sm:inline"> · </span>
      <a
        href="https://www.coingecko.com"
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:text-foreground hover:underline sm:inline"
      >
        Price data by CoinGecko
      </a>
    </footer>
  );
}
