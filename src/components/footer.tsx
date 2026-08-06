/**
 * Футер на всех страницах, 12px, --text-3 (дизайн-код §7).
 * Атрибуция CoinGecko обязательна по условиям API (ТЗ S1.4).
 *
 * Нижний отступ считается от выреза: с viewport-fit=cover (layout.tsx) ссылка
 * иначе уходит под home-indicator. max() — потому что на устройствах без
 * выреза inset равен нулю, а 24px нужны всегда.
 */
export function Footer() {
  return (
    <footer className="page-shell px-4 pt-6 pb-[max(24px,env(safe-area-inset-bottom))] text-[12px] text-text-3 sm:px-page">
      <div className="border-line border-t pt-4">
        <a
          href="https://www.coingecko.com"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors duration-120 ease-out hover:text-text-1"
        >
          Price data by CoinGecko
        </a>
      </div>
    </footer>
  );
}
