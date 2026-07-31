<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Зачем существует это приложение

Это трекер портфеля, который ведётся по конкретной стратегии — **Capital Growth**,
описанной в [docs/07-strategia-capital-growth.md](docs/07-strategia-capital-growth.md).
Прочитайте её перед тем, как проектировать или менять что-либо в учёте, метриках
или экранах: продукт обслуживает стратегию, а не наоборот.

Три вещи оттуда, о которые чаще всего спотыкаются:

1. **Главная метрика — количество BTC, а не доллары.** Долларовая стоимость
   отображается, но целью не является.
2. **Зоны ≠ категории.** У стратегии три зоны (Growth / Yield / Stability),
   у приложения — три категории (BTC / ETH / стейблы). Это разные разрезы:
   стейблкоины есть и в Stability, и в Yield.
3. **Уровни действий (−7 / −15 / −30 / −50 / −70%) считаются от подвижной точки
   отсчёта**, а не от текущей цены и не от максимума.

Раздел 10 документа — карта разрыва между стратегией и текущим приложением;
держите его в актуальном состоянии, когда закрываете очередной пункт.
