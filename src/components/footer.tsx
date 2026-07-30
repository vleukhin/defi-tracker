/**
 * Футер на всех страницах. Атрибуция CoinGecko обязательна по условиям API
 * (ТЗ S1.4). pb-20 на мобильных — чтобы нижняя навигация не перекрывала текст.
 */
export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white px-4 py-3 pb-20 text-center text-xs text-gray-500 sm:pb-3">
      <a
        href="https://www.coingecko.com"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-gray-700 hover:underline"
      >
        Price data by CoinGecko
      </a>
    </footer>
  );
}
