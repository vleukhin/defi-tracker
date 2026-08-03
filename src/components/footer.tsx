/**
 * Футер на всех страницах. Дисклеймер «Расчёт, а не финансовый совет» —
 * один раз внизу страницы, 12px, --text-3 (дизайн-код §7).
 * Атрибуция CoinGecko обязательна по условиям API (ТЗ S1.4).
 */
export function Footer() {
  return (
    <footer className="page-shell px-4 py-6 text-[12px] text-text-3 sm:px-page">
      <div className="border-line border-t pt-4">
        <span className="block sm:inline">Расчёт, а не финансовый совет</span>
        <span className="hidden sm:inline"> · </span>
        <a
          href="https://www.coingecko.com"
          target="_blank"
          rel="noopener noreferrer"
          className="block transition-colors duration-120 ease-out hover:text-text-1 sm:inline"
        >
          Price data by CoinGecko
        </a>
      </div>
    </footer>
  );
}
