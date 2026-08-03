# ТЗ. Часть 5: Дизайн-система «Terminal Blue»

> **Заменена.** Действующая дизайн-система — [08-dizain-kod.md](08-dizain-kod.md)
> (дизайн-код 1.0). Изменились палитра, шрифты (Inter/JetBrains Mono →
> IBM Plex Sans/Mono), типошкала, плотность и подача пояснений. Этот
> документ оставлен как история решений: на него нельзя опираться,
> проектируя новые экраны.

**Версия:** 1.0 (30.07.2026)
**Статус:** заменена дизайн-кодом 1.0
**Охват:** все экраны Фазы 1 — портфель, кошельки, цели и записи, настройки (+админ), вход/сброс пароля, навигация, футер, состояния.

Документ самодостаточен: реализатор не должен ничего изобретать — каждое значение задано. Что уже утверждено и **не меняется**: форматирование чисел (`src/lib/format.ts` — десятичная запятая, «$81 098», типографский минус), spreadsheet-таблица с границами ячеек как главный экран, русские тексты, API-слой и логика компонентов, существующая доступность (`aria-expanded`, `role="status"`, `role="alert"` и т.д.).

---

## 0. Направление

**Продукт** — инструмент ежедневной 30-секундной проверки портфеля из трех фиксированных категорий (BTC / ETH / Stablecoins). Дизайн обслуживает чтение чисел, а не наоборот.

**Настроение** — финтех-терминал: темная тема по умолчанию, глубина через тон поверхностей, аккуратный банковский синий, крупный итог. Никакого крипто-кринжа: без неоновых градиентов на весь экран, без глоу-эффектов, без 3D-монет.

Три решения, на которых держится идентичность:

1. **Числа говорят моноширинным голосом.** Все числовые данные (итог, таблица, карточки, суммы записей, адреса) набраны JetBrains Mono. UI-текст — Inter. Контраст «гуманистический текст / машинные цифры» — главный типографический прием: числа считываются колонками, как в терминале.
2. **Полоса аллокации — сигнатурный элемент.** Одна стековая полоса трех категорийных цветов с рисками-целями отвечает на главный вопрос («я в балансе?») быстрее таблицы. Ее мотив повторяется в логомарке (три вертикальные полоски) и в мини-превью на форме целей.
3. **Elevation тоном, не тенью.** В темной теме глубина задается ступенями светлоты поверхности (фон → карточка → поповер), тени почти не используются. В светлой теме — мягкие теневые ступени.

---

## 1. Дизайн-токены

### 1.1. Полный листинг `src/app/globals.css`

Файл заменяется целиком (текущий `@theme { --font-sans … }` уходит). Формат — shadcn/ui на Tailwind 4: сырые токены в `:root`/`.dark`, маппинг в утилиты через `@theme inline`. Канонические значения — oklch; hex в комментариях — для дизайн-ревью и проверки контраста.

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

/* ------- Светлая тема ------- */
:root {
  --background: oklch(0.977 0.004 250);        /* #f5f8fa — холодный белый */
  --foreground: oklch(0.22 0.02 258);          /* #151b24 */
  --card: oklch(1 0 0);                        /* #ffffff */
  --card-foreground: oklch(0.22 0.02 258);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.22 0.02 258);
  --primary: oklch(0.50 0.23 262);             /* #0151e3 — банковский синий */
  --primary-foreground: oklch(0.985 0 0);      /* #fafafa */
  --secondary: oklch(0.96 0.008 250);          /* #eef2f7 */
  --secondary-foreground: oklch(0.25 0.02 258);
  --muted: oklch(0.955 0.006 250);             /* #edf0f4 */
  --muted-foreground: oklch(0.50 0.02 257);    /* #5c646f */
  --accent: oklch(0.95 0.01 255);              /* #eaeff5 — hover-поверхность */
  --accent-foreground: oklch(0.22 0.02 258);
  --destructive: oklch(0.514 0.19 27);         /* #bc2021 */
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.90 0.008 250);             /* ≈#dde2e8 */
  --input: oklch(0.87 0.01 250);               /* ≈#d1d7e0 */
  --ring: oklch(0.50 0.23 262);
  --success: oklch(0.50 0.13 155);             /* #007840 */
  --warning: oklch(0.53 0.12 66);              /* #995b00 */
  --link: oklch(0.47 0.20 262);                /* #0e4ec8 */
  --chart-btc: oklch(0.62 0.15 55);            /* #c9690c */
  --chart-eth: oklch(0.51 0.19 275);           /* #4c52d0 */
  --chart-stable: oklch(0.56 0.10 180);        /* #098777 */
  /* Зоны стратегии Capital Growth (Фаза 6) — отдельный ряд, см. §1.3 */
  --zone-growth: oklch(0.58 0.15 38);          /* #c25430 */
  --zone-yield: oklch(0.55 0.14 135);          /* #4b8323 */
  --zone-stability: oklch(0.55 0.12 245);      /* #2677b2 */
  --radius: 0.625rem;
}

/* ------- Темная тема (по умолчанию) ------- */
.dark {
  --background: oklch(0.165 0.013 255);        /* #0b0f14 — сине-угольный */
  --foreground: oklch(0.955 0.004 250);        /* #eef0f3 */
  --card: oklch(0.205 0.015 255);              /* #13181e — elevation 1 */
  --card-foreground: oklch(0.955 0.004 250);
  --popover: oklch(0.225 0.016 255);           /* #171c23 — elevation 2 */
  --popover-foreground: oklch(0.955 0.004 250);
  --primary: oklch(0.546 0.245 262.9);         /* #165dfc */
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.27 0.02 255);           /* #202730 */
  --secondary-foreground: oklch(0.955 0.004 250);
  --muted: oklch(0.25 0.016 255);              /* #1d2229 */
  --muted-foreground: oklch(0.72 0.02 255);    /* #9ca5b1 */
  --accent: oklch(0.245 0.02 258);             /* #1b212a — hover-поверхность */
  --accent-foreground: oklch(0.955 0.004 250);
  --destructive: oklch(0.68 0.19 25);          /* #f75d59 */
  --destructive-foreground: oklch(0.16 0.03 25); /* ≈#180807 */
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 14%);
  --ring: oklch(0.62 0.19 255);                /* #1d84f5 */
  --success: oklch(0.75 0.15 155);             /* #4ec983 */
  --warning: oklch(0.80 0.14 80);              /* #edb345 */
  --link: oklch(0.74 0.13 255);                /* #70adfb */
  --chart-btc: oklch(0.75 0.15 60);            /* #f2943c */
  --chart-eth: oklch(0.67 0.15 278);           /* #8189ef */
  --chart-stable: oklch(0.76 0.12 180);        /* #42cab4 */
  --zone-growth: oklch(0.74 0.16 38);          /* #fe825c */
  --zone-yield: oklch(0.78 0.17 135);          /* #86cf57 */
  --zone-stability: oklch(0.72 0.13 242);      /* #4fadef */
}

/* ------- Маппинг в утилиты Tailwind 4 ------- */
@theme inline {
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: var(--font-jbmono), ui-monospace, "SF Mono", Menlo, monospace;

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-link: var(--link);
  --color-chart-btc: var(--chart-btc);
  --color-chart-eth: var(--chart-eth);
  --color-chart-stable: var(--chart-stable);
  --color-zone-growth: var(--zone-growth);
  --color-zone-yield: var(--zone-yield);
  --color-zone-stability: var(--zone-stability);

  --radius-sm: calc(var(--radius) - 4px);   /* 6px  — бейджи, мелкие элементы */
  --radius-md: calc(var(--radius) - 2px);   /* 8px  — кнопки, инпуты */
  --radius-lg: var(--radius);               /* 10px — поповеры, алерты */
  --radius-xl: calc(var(--radius) + 4px);   /* 14px — карточки */
}

/* ------- База ------- */
* { border-color: var(--border); }

body {
  font-family: var(--font-sans);
  background-color: var(--background);
  color: var(--foreground);
  /* Финтех-глубина: едва заметное синее «свечение» из-за верхней кромки.
     Радиальный градиент, а не заливка: на скролле фон остается спокойным. */
  background-image: radial-gradient(
    80rem 36rem at 50% -12rem,
    color-mix(in oklab, var(--primary) 8%, transparent),
    transparent 70%
  );
  background-repeat: no-repeat;
}
.dark body,
body:where(.dark, .dark *) {
  background-image: radial-gradient(
    80rem 36rem at 50% -12rem,
    color-mix(in oklab, var(--primary) 10%, transparent),
    transparent 70%
  );
}

/* Все числовые данные: моноширинные табличные цифры */
.font-mono { font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Примечания:

- Шум/зерно на фон **не** добавляем — на плотных таблицах это грязь, а не настроение.
- Тинтованные фоны баннеров и бейджей задаются на месте через `color-mix`: `bg-warning/10` (Tailwind сам раскроет alpha) или `color-mix(in oklab, var(--warning) 12%, var(--card))` — см. §6.
- `--link` — для текстовых ссылок («Забыли пароль?», CoinGecko при hover): в темной теме `--primary` слишком темен для мелкого текста (2.9:1), поэтому отдельный токен.

### 1.2. Проверка контраста (посчитано, WCAG 2.1)

Требование: основной текст ≥ 4.5:1, вторичный текст ≥ 4.5:1 (перевыполняем заявленные 3:1), нетекстовые элементы (точки категорий, сегменты полосы, рамки контролов) ≥ 3:1.

**Темная тема:**

| Пара | Коэффициент | Норма | Статус |
|---|---|---|---|
| foreground / background | 16.9:1 | 4.5 | OK |
| foreground / card | 15.7:1 | 4.5 | OK |
| muted-foreground / card | 7.2:1 | 3.0 (вторичный) | OK |
| primary-foreground / primary (кнопка) | 5.0:1 | 4.5 | OK |
| link / card | 7.8:1 | 4.5 | OK |
| success / card (текст «купить») | 8.6:1 | 4.5 | OK |
| warning / card (текст отклонения) | 9.5:1 | 4.5 | OK |
| destructive / card (текст «продать», ошибки) | 5.7:1 | 4.5 | OK |
| destructive-foreground / destructive (кнопка) | 6.2:1 | 4.5 | OK |
| warning / тинт warning 12% на card (баннер) | 7.6:1 | 4.5 | OK |
| chart-btc / card | 7.8:1 | 3.0 | OK |
| chart-eth / card | 5.8:1 | 3.0 | OK |
| chart-stable / card | 8.8:1 | 3.0 | OK |
| zone-growth / card | 7.3:1 | 3.0 | OK |
| zone-yield / card | 9.4:1 | 3.0 | OK |
| zone-stability / card | 7.3:1 | 3.0 | OK |

**Светлая тема:**

| Пара | Коэффициент | Норма | Статус |
|---|---|---|---|
| foreground / background | 16.2:1 | 4.5 | OK |
| foreground / card | 17.3:1 | 4.5 | OK |
| muted-foreground / card | 6.0:1 | 3.0 (вторичный) | OK |
| primary-foreground / primary (кнопка) | 6.1:1 | 4.5 | OK |
| link / card | 7.2:1 | 4.5 | OK |
| success / card | 5.6:1 | 4.5 | OK |
| warning / card | 5.4:1 | 4.5 | OK |
| destructive / card | 6.2:1 | 4.5 | OK |
| destructive-foreground / destructive | 6.0:1 | 4.5 | OK |
| warning / тинт warning 12% на card | 4.6:1 | 4.5 | OK |
| chart-btc / card | 3.8:1 | 3.0 | OK |
| chart-eth / card | 6.1:1 | 3.0 | OK |
| chart-stable / card | 4.4:1 | 3.0 | OK |
| zone-growth / card | 4.6:1 | 3.0 | OK |
| zone-yield / card | 4.6:1 | 3.0 | OK |
| zone-stability / card | 4.8:1 | 3.0 | OK |

### 1.3. Правила применения цветов категорий и семантики

- **Цвета категорий** (`--chart-btc` оранжевый, `--chart-eth` индиго, `--chart-stable` бирюзовый) используются **только как заливки**: точки-маркеры, сегменты полосы, тинты карточек, левые границы раскрытых строк. **Никогда как цвет текста** — так они остаются яркими в обеих темах без компромиссов по контрасту. Подпись категории — всегда обычный `foreground` с цветной точкой рядом.
- Отличимость: оранжевый / индиго / бирюзовый различимы при всех основных типах дальтонизма (разведены и по тону, и по светлоте); в полосе аллокации сегменты дополнительно разделены зазорами 2px и подписаны в легенде.
- **Цвета зон стратегии** (`--zone-growth` оранжевый, `--zone-yield` зелёный, `--zone-stability` синий) — отдельный ряд, а не переиспользование категорийных. Зона и категория это разные разрезы (docs/07 §10.1): категория отвечает «в чём лежит», зона — «какую задачу решает», и стейблкоины есть сразу в двух зонах. Общий цвет склеивал бы разрезы и подсказывал бы неверное. Правило применения то же, что у категорий: **только заливка** — точка, левая кромка карточки, тинт фона, сегмент полосы; текст всегда `foreground`.
- Оттенки зон разведены с ближайшими соседями палитры (Growth ↔ BTC-оранжевый, Yield ↔ success-зелёный, Stability ↔ ETH-индиго и `primary`): расстояние в oklab ≥ 0.06 в обеих темах, чтобы точка зоны не читалась как категорийная. Зелёный зоны намеренно травяной (hue 135), а не изумрудный: изумрудный занят семантикой «купить».
- **Семантика действий:** «купить» (положительное «к ребалансировке») — `--success`; «продать» (отрицательное) — `--destructive`. Знак `+`/`−` всегда присутствует в тексте — цвет никогда не единственный признак (это уже гарантируют форматтеры `tableSigned`/`formatSignedAmount`).
- **Предупреждения** (отклонение за порогом ±5 п.п., устаревшие данные, сумма целей ≠ 100%) — `--warning`. Оттенок предупреждения (янтарный, hue 66–80) сознательно желтее BTC-оранжевого (hue 55–60) и появляется только в баннерах/бейджах с текстом — не путается с точкой BTC.
- `--destructive` двойного назначения: текст ошибок и фон разрушающих кнопок; в каждой теме подобран так, что проходит 4.5:1 в обеих ролях (см. таблицы выше).

---

## 2. Типографика

### 2.1. Шрифты (next/font, Google Fonts, self-hosted автоматически)

| Роль | Шрифт | Subsets | Переменная |
|---|---|---|---|
| UI-текст | **Inter** (variable) | `latin`, `cyrillic` | `--font-inter` |
| Числа, адреса, код | **JetBrains Mono** (variable) | `latin`, `cyrillic` | `--font-jbmono` |

Подключение в `src/app/layout.tsx`:

```tsx
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});
const jbMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-jbmono",
  display: "swap",
});

// <html lang="ru" className={`${inter.variable} ${jbMono.variable}`} suppressHydrationWarning>
```

Оба шрифта поддерживают кириллицу — «п.п.», «нет цены», «мин назад» внутри числовых строк не выпадают в fallback.

### 2.2. Размерная шкала

| Стиль | Классы | Где |
|---|---|---|
| Display (итог портфеля) | `font-mono text-3xl sm:text-4xl font-semibold tracking-tight` | шапка дашборда |
| H1 страницы | `text-2xl font-semibold tracking-tight` | все страницы (как сейчас) |
| Значение в карточке-метрике | `font-mono text-lg font-semibold` | карточки категорий |
| H2 секции | `text-sm font-semibold` | заголовки карточек |
| Body | `text-sm` (14px) | основной текст, ячейки |
| Числа таблицы | `font-mono text-sm` | все числовые ячейки |
| Meta / подписи | `text-xs text-muted-foreground` (12px) | свежесть, подсказки, легенды |
| Шапка таблицы, dt-подписи | `text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground` | th таблицы, подписи в мобильных карточках |
| Адреса | `font-mono text-xs` | списки кошельков, состав залога |

Правила:

- **Всё числовое — `font-mono`** (tabular-nums включен глобально, §1.1). Существующие форматтеры из `src/lib/format.ts` не меняются — меняется только шрифт отображения.
- Вес: Inter 400/500/600, JetBrains Mono 400/500/600. 700 не используется нигде.
- `line-height` — дефолты Tailwind; для display-итога `leading-none`.

---

## 3. Поверхности и глубина

| Уровень | Темная тема | Светлая тема | Что лежит |
|---|---|---|---|
| 0 — фон | `--background` #0b0f14 + радиальный градиент (§1.1) | #f5f8fa + градиент | страница |
| 1 — карточка | `--card` #13181e + `border border-border` | #ffffff + `border` + `shadow-sm` | все карточки, таблица |
| 2 — оверлей | `--popover` #171c23 + `border` + `shadow-lg` | #ffffff + `border` + `shadow-lg` | dropdown, dialog, tooltip, toast |

- Радиусы: карточки `rounded-xl` (14px), кнопки/инпуты/бейджи-строки `rounded-md` (8px), мелкие бейджи `rounded-sm` (6px), полоса аллокации и точки — `rounded-full`.
- В темной теме теней на карточках **нет** — elevation читается тоном + границей `oklch(1 0 0 / 10%)`. Единственные тени темной темы — у оверлеев (уровень 2), чтобы отделить их от карточек.
- Hover-поверхности: `--accent` (строки таблицы, пункты меню, ghost-кнопки).
- Фокус: везде `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background` (дефолт shadcn) — видимый синий контур в обеих темах.
- Внутренние отступы карточек: `p-4` (16px); заголовочные зоны карточек-списков: `px-4 py-3` с `border-b border-border`.
- Сетка страницы: контейнер `max-w-5xl px-4`, вертикальный ритм между блоками `space-y-5` (20px) на дашборде, `space-y-4` на остальных.

---

## 4. Компоненты shadcn/ui

### 4.1. Установка

```bash
npx shadcn@latest init      # style: new-york, base color: neutral, CSS variables: yes
npx shadcn@latest add button card input label badge table skeleton \
  separator switch tooltip alert alert-dialog dropdown-menu sonner
```

После `init` палитру в `globals.css` заменить на листинг §1.1 (init сгенерирует нейтральную — она не наша).

Сознательно **не** ставим из «стандартного» списка: `tabs`, `select`, `dialog` — в Фазе 1 для них нет ни одного применения (появятся со сделками и историей в Фазах 2–3); не тащим мертвый код.

Иконки — `lucide-react` (ставится вместе с shadcn): размер 16px внутри кнопок и строк, 20px в навигации. Emoji-стрелки `▸/▾` и `⚠` в таблице заменяются на `ChevronRight` (с поворотом) и `TriangleAlert` 14px.

### 4.2. Кастомизация поверх дефолтов

| Компонент | Отступление от дефолта |
|---|---|
| **Button** | Дефолтные варианты. Использование: `default` — единственное главное действие экрана (Сохранить, Добавить, Войти); `secondary` — второстепенные (Отмена, Внести вручную); `outline` — «Обновить», «Повторить»; `ghost` — иконки-действия (копировать, удалить запись, тема); `destructive` — только финальное подтверждение в AlertDialog. Высота `h-9`, в auth-формах `h-10`. |
| **Card** | Без `CardHeader/CardFooter`-обвязки там, где карточка — список: `p-0` + внутренние зоны `px-4 py-3` и `divide-y divide-border`. |
| **Badge** | Добавить варианты: `success` (`bg-success/12 text-success border-transparent`), `warning` (`bg-warning/12 text-warning`), `muted` (`bg-muted text-muted-foreground`). Числовые бейджи — `font-mono`. |
| **Alert** | Добавить варианты `warning` и `success` по образцу `destructive`: `border-warning/30 bg-warning/10 text-warning [&>svg]:text-warning` (заголовок и иконка — семантическим цветом, основной текст — `text-foreground`). |
| **Table** | Наша таблица — spreadsheet, дефолтный стиль shadcn (только горизонтальные линии) **не подходит**. Ячейкам возвращаются полные границы: `border border-border` на `th`/`td` (см. §5.1.6). Компонент shadcn используется как база (обертка, overflow), классы ячеек — свои. |
| **Skeleton** | Дефолт (`bg-muted animate-pulse`), формы — в §6.1. |
| **Sonner (toast)** | `position="bottom-right"` на десктопе; `richColors={false}` — цвета из токенов; на мобильных снизу поверх нижней навигации не вешаем — `position="top-center"` при `< 640px`. |
| **Tooltip** | `delayDuration={200}`. Для чисел внутри тултипа — `font-mono`. |
| **AlertDialog** | Все подтверждения удаления (кошелек, пользователь). Кнопка действия — `variant="destructive"`. |
| **DropdownMenu** | Переключатель темы (§5.6.3). |
| **Switch** | Checked-состояние — `bg-primary`. |

### 4.3. Карта «экран → компоненты»

| Экран | Компоненты |
|---|---|
| Портфель | Card, Badge, Button (outline/ghost), Alert (warning/destructive), Skeleton, Tooltip + кастомные: MetricCards, AllocationBar, SparklinePlaceholder, PortfolioTable |
| Кошельки | Card, Input, Label, Button, Alert (success — read-only notice), AlertDialog, Skeleton, Tooltip (копирование) |
| Цели и записи | Card, Input, Label, Button, Badge, Alert, Sonner, Skeleton + мини-превью полосы |
| Настройки | Card, Separator, Badge, Button, Switch/DropdownMenu (тема), AlertDialog (удаление пользователя), Sonner |
| Auth | Card, Input, Label, Button, Alert (destructive) |
| Навигация | Button (ghost), DropdownMenu (тема) + кастомные TopBar/BottomBar |

### 4.4. Кастомные компоненты (новые файлы)

| Файл | Что |
|---|---|
| `src/components/logo.tsx` | Логомарк: три вертикальные скругленные полоски (цвета `chart-btc`, `chart-eth`, `chart-stable`, высоты 16/10/13px — эхо аллокации) + текст «DeFi Portfolio» `text-sm font-semibold tracking-tight`. Проп `size` («sm» — навигация, «lg» — auth). Инлайн-SVG, без файлов-ассетов. |
| `src/components/theme-toggle.tsx` | Ghost-кнопка `Sun`/`Moon` + DropdownMenu: Светлая / Темная / Системная (`useTheme` из next-themes). `aria-label="Переключить тему"`. |
| `src/components/portfolio/metric-cards.tsx` | Ряд карточек категорий (§5.1.3). |
| `src/components/portfolio/allocation-bar.tsx` | Полоса аллокации (§5.1.4). |
| `src/components/portfolio/sparkline-placeholder.tsx` | Заготовка спарклайна (§5.1.5). |

---

## 5. Поэкранные спецификации

### 5.1. Портфель (`/`)

Раскладка десктопа (контейнер `max-w-5xl`, `space-y-5`):

```text
┌────────────────────────────────────────────────────────────────┐
│ Портфель                                        [⟳ Обновить]   │
│ $153 001                                                       │
│ цены: 2 мин назад · залог: 5 мин назад                         │
├─ (баннеры деградации — только при проблемах) ──────────────────┤
│ ┌── BTC ────────┐ ┌── ETH ────────┐ ┌── Stablecoins ─────────┐ │
│ │ ● BTC  [+3,00]│ │ ● ETH  [+1,15]│ │ ● Stablecoins  [−4,15] │ │
│ │ $81 098       │ │ $32 355       │ │ $39 548                │ │
│ │ 53,00% → 50%  │ │ 21,15% → 20%  │ │ 25,85% → 30%           │ │
│ └───────────────┘ └───────────────┘ └────────────────────────┘ │
│ ┌─ Аллокация ──────────────────────────────────────────────── ┐│
│ │ ████████████████▌│██████▌│█████████▌   ← риски на 50% и 70% ││
│ │ ● BTC 53,00%  ● ETH 21,15%  ● Stablecoins 25,85%            ││
│ └──────────────────────────────────────────────────────────── ┘│
│ ┌─ Динамика стоимости ─────────────────────────────────────── ┐│
│ │  – – – – – – – (заготовка, Фаза 3) – – – – – – –            ││
│ └──────────────────────────────────────────────────────────── ┘│
│ ┌─ Таблица (spreadsheet, без изменений структуры) ──────────── ┐│
│ └──────────────────────────────────────────────────────────── ┘│
│ Количество к ребалансировке — расчет, а не финансовый совет.   │
└────────────────────────────────────────────────────────────────┘
```

#### 5.1.1. Шапка

- `h1` «Портфель» — H1 стиль. Под ним итог: **display-стиль** (`font-mono text-3xl sm:text-4xl font-semibold tracking-tight leading-none`, существующий `tableUsd`). Итог — самый крупный элемент экрана, это тезис страницы.
- Строка свежести — meta-стиль, разделители `·` как сейчас; текст не менять. Во время обновления к строке добавляется «обновляется…» + пульсирующая точка 6px `bg-primary animate-pulse` перед словом.
- Кнопка «Обновить» — `Button variant="outline" size="sm"`, иконка `RefreshCw` 16px слева; при `refreshing` — `disabled`, иконка `animate-spin`, текст «Обновление…». Позиция: справа от заголовка (flex, как сейчас).

#### 5.1.2. Баннеры деградации

- Ошибка обновления и «данные устарели» по сетям — `Alert variant="warning"`: иконка `TriangleAlert`, заголовок — имя сети, текст — существующая строка «данные устарели (…)». Несколько сетей — несколько строк в **одном** Alert (списком), а не стопка баннеров.
- Ошибки — неблокирующие, таблица под ними живет (текущая логика сохраняется).

#### 5.1.3. Карточки-метрики категорий

Grid: `grid grid-cols-1 sm:grid-cols-3 gap-3`. Итог в карточку **не** выносится (он в шапке — не дублируем). Каждая карточка (уровень 1):

- Фон с категорийным тинтом: `background: color-mix(in oklab, var(--chart-btc) 5%, var(--card))` (и аналогично eth/stable) — «цветные карточки» финтех-настроения без потери читаемости; в светлой теме тот же рецепт.
- Строка 1: точка 8px `rounded-full bg-chart-*` + подпись категории (`text-sm font-medium`) + справа **бейдж отклонения**: `Badge variant="warning"` с `tablePctSigned` если |отклонение| > 5 п.п., иначе `Badge variant="muted"`; без целей — бейдж не рендерится.
- Строка 2: стоимость `font-mono text-lg font-semibold` (`tableUsd`).
- Строка 3 (meta): `53,00% → цель 50,00%` — `font-mono text-xs text-muted-foreground`; без цели — просто доля.
- Паддинг `p-4`, между строками `space-y-1.5`. Карточки некликабельны (весь детальный разбор — в таблице ниже); hover-эффектов нет.

#### 5.1.4. Полоса аллокации (сигнатурный элемент)

Карточка уровня 1, `p-4`:

- Заголовок не нужен — полоса самоописательна с легендой.
- **Полоса**: контейнер `relative h-3 rounded-full`, внутри flex-сегменты BTC → ETH → Stablecoins (порядок фиксирован, как в таблице), ширина = доля в %, зазор между сегментами 2px (`gap-0.5`), крайние сегменты скруглены наружу (`first:rounded-l-full last:rounded-r-full`). Сегмент с долей < 1% получает `min-width: 4px`. Заливки — `bg-chart-*`.
- **Риски целей**: при заданных целях — вертикальные маркеры на *кумулятивных* границах целей: первая на `x = цель_BTC%`, вторая на `x = цель_BTC + цель_ETH%`. Маркер: `absolute w-0.5 -top-1 -bottom-1 rounded-full bg-foreground/70` (выступает на 4px над и под полосой). Смысл: фактические стыки сегментов совпадают с рисками → портфель в балансе; расхождение видно как сдвиг стыка от риски. Каждая риска — с Tooltip: «Цель BTC: 50,00%».
- **Легенда** (под полосой, `mt-2.5 flex flex-wrap gap-x-4 gap-y-1`): для каждой категории — точка 8px + `BTC` (`text-xs`) + `53,00%` (`font-mono text-xs`) + при наличии цели `→ 50,00%` (`text-muted-foreground`).
- Анимация: `transition-[width] duration-400 ease-out` на сегментах при обновлении данных.
- **Без целей**: полоса без рисок; справа в легенде ссылка «Задать цели →» (`text-link text-xs`). Существующая CTA-карточка «Задайте целевые проценты…» при `targetSumPct === 0` сохраняется (над полосой), стилизуется как Card с кнопкой `default`.
- **Итог = 0**: один сегмент `bg-muted` на всю ширину, легенда «Портфель пуст».
- Доступность: контейнер полосы — `role="img"` c `aria-label="Аллокация: BTC 53,00% при цели 50,00%, …"` (строка собирается из тех же форматтеров).

#### 5.1.5. Спарклайн-заготовка (до Фазы 3)

Карточка уровня 1, на всю ширину, `p-4`:

- Заголовок «Динамика стоимости» (H2-стиль) + справа `Badge variant="muted"` «Фаза 3».
- Тело высотой 96px (72px на мобильных): по вертикальному центру — горизонтальная пунктирная линия (`border-t border-dashed border-border`), поверх нее по центру текст `text-xs text-muted-foreground` на подложке `bg-card px-2`: «График появится после первых снепшотов». 
- **Никаких фейковых данных, осей и градиентных заливок.** Заготовка честно пустая; когда в Фазе 3 появятся снепшоты, на этом месте будет линия стоимости за 30 дней.

#### 5.1.6. Таблица

Структура, колонки, форматтеры, tooltips, `aria-expanded` — **без изменений**. Отделка:

- Обертка: `Card` `p-0 overflow-hidden` (внешняя рамка и радиус — от карточки), внутри `overflow-x-auto`.
- Шапка: `bg-muted/60`, стиль ячеек — «шапка таблицы» из §2.2 (11px uppercase). Границы `border border-border`.
- Ячейки: `border border-border px-3 py-2 text-right font-mono text-sm` (числа), первая колонка — Inter. **Зебры нет** — сетка границ уже структурирует; зебра поверх границ = визуальный шум.
- Первая колонка: `ChevronRight` 14px `text-muted-foreground` (поворот на 90° при раскрытии, `transition-transform duration-150`) + точка категории 8px `bg-chart-*` + подпись.
- Hover строки: `hover:bg-accent/50 transition-colors duration-120`.
- Отклонение за порогом ±5 п.п.: `text-warning font-medium` (заменяет текущие orange/sky — направление уже кодируется знаком).
- «К ребалансировке»: положительное — `text-success`, отрицательное — `text-destructive`, ноль/«—» — обычный. Существующий title «Купить/Продать…» сохраняется.
- Строки-предупреждения: `bg-warning/10 text-warning text-xs`, иконка `TriangleAlert` 14px вместо «⚠».
- Раскрытая строка состава: фон `bg-muted/40`, слева внутренняя граница 2px цвета категории (`box-shadow: inset 2px 0 0 var(--chart-btc)`); внутренности (`RowDetail`) — стили текущие, числа `font-mono`, подписи секций — meta-стиль.
- Итоговая строка: `bg-muted/60`, значение `font-mono font-semibold`.

**Мобильная версия** (< md) — стек карточек, структура и логика текущие, отделка:

- Обертка: `Card p-0 divide-y divide-border`.
- Карточка категории: `px-4 py-3`; заголовочная строка: chevron + точка категории + подпись (`text-sm font-medium`) + стоимость справа (`font-mono text-sm font-semibold`).
- Сетка пар: `dt` — стиль «11px uppercase» из §2.2, `dd` — `font-mono text-sm`. Цветовые правила отклонения и «к ребалансировке» — как на десктопе.
- Строка «Итого»: `bg-muted/60`, значение `font-mono text-base font-semibold`.
- Тап-зона всей карточки ≥ 44px, `active:bg-accent/50`.

#### 5.1.7. Мобильная раскладка экрана (375px, сверху вниз)

1. H1 + итог (`text-3xl`) + свежесть; кнопка «Обновить» — иконка-кнопка `outline size="icon"` справа от заголовка (текст не влезает).
2. Мини-карточки категорий: `grid-cols-3 gap-2`, урезанное содержимое: точка + тикер (`text-xs`), стоимость (`font-mono text-sm font-semibold`), доля (`font-mono text-[11px] text-muted-foreground`). Бейдж отклонения заменяется цветом доли: за порогом — `text-warning`.
3. Полоса аллокации (легенда — только точки и проценты, без слова «цель»; риски остаются).
4. Спарклайн-заготовка (72px).
5. Таблица-карточки.
6. Дисклеймер.

#### 5.1.8. Пустое состояние (нет кошельков и итог 0)

Текущая структура `EmptyState` сохраняется, отделка: Card `p-6 text-center`; сверху логомарк-полоски 24px по центру (`opacity-60`); заголовок `text-base font-medium`, текст `text-sm text-muted-foreground max-w-md`; кнопки: «Добавить кошелек» `default`, «Внести вручную» `secondary`. Вместо метрик/полосы/спарклайна — ничего (пустое состояние заменяет весь дашборд, как сейчас).

### 5.2. Кошельки (`/wallets`)

Порядок блоков: read-only уведомление → карточка добавления → список.

- **Read-only notice**: `Alert variant="success"` с иконкой `ShieldCheck` 16px. Заголовок «Только просмотр.» — `text-success font-medium`; тело «Приложение не может распоряжаться средствами.» — `text-foreground`. Роль `note` сохраняется.
- **Карточка добавления**: Card `p-4 space-y-3`; заголовок H2 «Добавить адрес». Поле адреса: `Input` + `font-mono placeholder:font-mono` (`0x…`), `spellCheck=false`. Метка — обычный Input. Ошибка — `role="alert"` строка `text-destructive text-sm` (тексты текущие). Кнопка «Добавить» — `default`. Подпись про 4 сети — meta-стиль.
- **Список**: Card `p-0 divide-y divide-border`; строка: метка (`text-sm font-medium`), адрес `font-mono text-xs text-muted-foreground` + ghost-иконка `Copy` 16px (после копирования — `Check` `text-success` 1.5с; `aria-label` текущий), свежесть meta-стилем. Справа кнопка «Удалить» — `ghost` `text-muted-foreground hover:text-destructive`.
- **Удаление** — `AlertDialog`: заголовок «Удалить кошелек?», текст «Балансы этого кошелька будут убраны из портфеля.» (текущий), действия: «Отмена» (`secondary`) / «Удалить» (`destructive`). Заменяет инлайн-подтверждение; текущая семантика `role="alertdialog"` у компонента shadcn встроена.
- Пустой список: строка в Card — «Кошельков пока нет — добавьте первый адрес выше.» `text-sm text-muted-foreground text-center py-6`.

### 5.3. Цели и записи (`/targets`)

- **Карточка целей**: Card `p-4`. Заголовок H2 + подсказка meta. Три строки: точка категории 8px + label слева; справа `Input` `w-24 text-right font-mono` + «%» meta. 
- **Индикатор суммы** (`role="status"` сохраняется): строка под полями — при 100%: `text-success text-sm` «Сумма: 100%» + под ней **мини-превью полосы**: `h-1.5 rounded-full` сегменты по целям (те же правила, что §5.1.4, без рисок и легенды) — пользователь видит будущую аллокацию еще до сохранения; при ≠ 100%: `Alert variant="warning"` компактный (`py-2`) с текущим текстом, превью скрыто.
- Кнопка «Сохранить цели» — `default`. Успех — Sonner-тост «Цели сохранены» (+ предупреждение, если есть); ошибка — инлайн `text-destructive` (не тостом: ошибка должна остаться на экране).
- **Три секции ручных записей** (BTC / ETH / Stablecoins): Card `p-0`; шапка `px-4 py-3 border-b`: точка категории + «BTC — вручную» H2 + сумма справа `font-mono text-sm`; подсказка meta. Форма добавления: `px-4 py-3`, Input подписи (flex-1) + Input суммы (`w-32 text-right font-mono`) + кнопка «Добавить» `secondary`. Список: `divide-y`; строка — подпись `truncate text-sm` + количество `font-mono text-sm` + единица meta + ghost-иконка `X` 16px (`aria-label` «Удалить запись …» — текущий); удаление записи без диалога (низкая цена ошибки — текущее поведение), после — тост «Запись удалена».
- Пустые списки: «Записей пока нет.» meta-стилем (текст текущий).

### 5.4. Настройки (`/settings`)

- Карточка параметров: Card `p-0 divide-y divide-border`, строки `px-4 py-3`: подпись meta-стилем сверху, значение `text-sm` (email — `font-mono`).
- **Новая строка «Тема»**: подпись «Тема» + сегментный контрол из трех кнопок (`Button size="sm"`, активная — `secondary`, неактивные — `ghost`): «Светлая / Темная / Системная». Дублирует переключатель из шапки — на мобильных это основная точка входа. 
- Строка порога 5 п.п. и строка «Выход» — как сейчас, в новых стилях.
- **Админ-секция «Пользователи»**: Card `p-0`; шапка с H2 и подсказкой; форма создания: email + пароль + кнопка «Создать» `default` (в столбец на мобильных). Статусы: успех — тост, ошибка — инлайн `text-destructive` `role="status"` (текущие тексты). Список: `divide-y`; строка: email `text-sm` + `Badge variant="muted"` «админ» + «(вы)» meta; последний вход — meta; справа «Удалить» ghost → **AlertDialog**: «Удалить пользователя example@mail?» / «Пользователь будет удален вместе со всеми его данными.» / «Отмена» + «Да, удалить» `destructive`.
- Внизу страницы — существующая строка-дисклеймер meta-стилем.

### 5.5. Вход и сброс пароля (`/login`, `/reset-password`, `/reset-password/update`)

Auth живет в тех же темах (темная по умолчанию), переключателя темы на этих страницах нет.

- Раскладка: по центру экрана (текущий layout), `max-w-sm`. Над карточкой — **логомарк `lg`** (полоски 24px + «DeFi Portfolio Tracker» `text-lg font-semibold`), по центру, `mb-6`.
- Карточка: Card `rounded-xl p-6 space-y-4`; в светлой теме `shadow-lg shadow-black/5`, в темной — без тени (уровень 1).
- Заголовок формы («Вход», «Сброс пароля», «Новый пароль») — `text-lg font-medium` (как сейчас).
- Поля: `Label` (`text-sm font-medium`) + `Input h-10`; пароль — `font-mono` не применяем (маскированные точки в mono выглядят разреженно) — обычный Inter.
- Кнопка отправки: `default`, `w-full h-10`.
- Ошибки: `Alert variant="destructive"` компактный (`py-2.5`, иконка `CircleAlert` 16px), `role="alert"` — тексты текущие.
- Ссылки («Забыли пароль?», «Ко входу») — `text-link text-sm hover:underline underline-offset-4`.
- Состояние «Проверьте почту» — текущая структура; email внутри текста — `font-medium`.
- Фон страницы — общий градиент из §1.1, никакой отдельной сцены. Футер виден.

### 5.6. Навигация и футер

#### 5.6.1. Верхняя панель (все брейкпоинты)

- `sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-md`.
- Слева — логомарк `sm` (ссылка на `/`).
- Центр (только ≥ sm): ссылки-пилюли: активная — `bg-accent text-foreground font-medium rounded-md`, неактивные — `text-muted-foreground hover:bg-accent/60 hover:text-foreground`; `aria-current="page"` сохраняется. `px-3 py-1.5 text-sm`.
- Справа: ThemeToggle (ghost-иконка) + «Выйти» (`ghost text-muted-foreground`, форма POST текущая). На мобильных правый блок тот же (иконка темы + «Выйти»).

#### 5.6.2. Нижняя навигация (< sm)

- `fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/90 backdrop-blur-md`, высота 56px + `pb-[env(safe-area-inset-bottom)]`.
- 4 пункта (`grid-cols-4`): иконка 20px + подпись `text-[11px]`: `ChartPie` Портфель, `Wallet` Кошельки, `Target` Цели, `Settings` Настройки. Подпись «Цели и записи» в нижнем баре сокращается до «Цели» (в верхней навигации — полная).
- Активный пункт: `text-primary` (иконка + текст, ≥3:1 к фону в обеих темах — является UI-индикатором при сохраненном `aria-current`); неактивные — `text-muted-foreground`.
- Отступ контента снизу (`pb-20` на мобильных у футера) сохраняется.

#### 5.6.3. Переключатель темы

- next-themes: `attribute="class"`, `defaultTheme="dark"`, `enableSystem`, `disableTransitionOnChange`; `suppressHydrationWarning` на `<html>`.
- В шапке: ghost-иконка (`Sun` в светлой / `Moon` в темной, 20px) → DropdownMenu: «Светлая», «Темная», «Системная»; активный пункт — с `Check` 16px.
- До гидрации иконка рендерится как нейтральный `SunMoon` (без мигания темы благодаря next-themes-скрипту).

#### 5.6.4. Футер

- `border-t border-border bg-transparent`, meta-стиль, по центру: «Расчеты, а не финансовые советы · Price data by CoinGecko» (CoinGecko — ссылка `hover:text-foreground hover:underline`, атрибуция обязательна по ТЗ §6.4). На мобильных `·` заменяется переносом строки. `pb-20 sm:pb-3` сохраняется.
- Страничные дисклеймеры (под таблицей и в настройках) остаются как есть — тексты не трогаем.

---

## 6. Состояния

### 6.1. Skeleton-паттерны (пока `loading && !data`)

Все скелетоны — `Skeleton` (`bg-muted animate-pulse`), формой повторяют будущий контент (никаких экранов «только спиннер» — ТЗ §6.1):

- **Портфель**: строка `h-9 w-44` (итог) + `h-4 w-64` (свежесть) → 3 карточки `h-[92px] rounded-xl` → полоса `h-3 rounded-full` → прямоугольник `h-64 rounded-xl` (таблица). Спарклайн-заготовку скелетоном не дублируем — она статична.
- **Кошельки**: форма рендерится сразу (она не зависит от данных), список — `h-24 rounded-xl`.
- **Цели и записи**: поля формы рендерятся сразу пустыми (текущая логика), списки записей — «Загрузка…» meta-стилем (текущее) или `h-10` строки.
- **Настройки/админ**: строка «Загрузка…» meta-стилем (текущее поведение).

### 6.2. Ошибки

| Ситуация | Оформление |
|---|---|
| Не удалось загрузить экран (нет данных вовсе) | `Alert variant="destructive"` (иконка `CircleAlert`) + текущий текст + кнопка «Повторить» `outline size="sm"` внутри Alert |
| Сеть деградировала / данные устарели | `Alert variant="warning"`, одна карточка со списком сетей (§5.1.2) |
| Ошибка формы (валидация, 409 и т.д.) | инлайн `text-destructive text-sm` с `role="alert"`/`role="status"` — рядом с формой, не исчезает |
| Успех действия | Sonner-тост (Цели сохранены / Пользователь создан / Запись удалена) |
| «обновляется…» | meta-текст в строке свежести + пульс-точка + спиннер в кнопке (§5.1.1) |
| Цена устарела (в ячейке) | текущий маркер «!» заменить на `TriangleAlert` 12px `text-warning` с существующим `title` |

### 6.3. Пустые состояния

Единый шаблон: по центру карточки — иконка/логомарк `opacity-60`, заголовок `text-base font-medium`, 1–2 строки объяснения `text-sm text-muted-foreground`, CTA-кнопки. Конкретные тексты — существующие (не менять): пустой портфель (§5.1.8), пустой список кошельков, «Записей пока нет.», пустой состав категории в раскрытой строке.

---

## 7. Анимации

Сдержанные: только CSS transitions + два keyframe-эффекта (pulse, spin). Framer Motion не подключается.

| Что | Свойство | Длительность / изинг |
|---|---|---|
| Hover кнопок, ссылок, пилюль, строк | `background-color, color, border-color` | 120ms / `ease-out` |
| Chevron раскрытия строки | `transform: rotate(90deg)` | 150ms / `ease` |
| Раскрытие состава строки | без анимации высоты (table-row анимируется плохо и тормозит чтение) — контент появляется сразу | — |
| Сегменты полосы аллокации | `width` | 400ms / `ease-out` |
| Skeleton | `animate-pulse` | 2s / `cubic-bezier(0.4,0,0.6,1)` (дефолт Tailwind) |
| Иконка обновления | `animate-spin` | 1s / `linear` |
| Пульс-точка «обновляется…» | `animate-pulse` | 2s |
| Появление dropdown/dialog/toast | дефолтные транзишены shadcn (fade+zoom ~150–200ms) | не менять |
| Смена темы | **мгновенно**, без транзишенов (`disableTransitionOnChange`) | — |
| Focus ring | мгновенно | — |

`prefers-reduced-motion: reduce` — глобальный сброс уже в листинге §1.1 (все транзишены и анимации ~0ms): скелетоны становятся статичными, спиннер замирает (текст «Обновление…» остается информатором), полоса меняет ширину без анимации.

Запрещено: parallax, глоу-тени, hover-подъемы карточек (`translateY`), scale на кнопках, анимации букв/чисел (счетчики-каунтеры замедляют чтение — итог всегда показывается сразу).

---

## 8. Реализационные заметки для Frontend Developer

### 8.1. Порядок работ

1. **Фундамент**: `npm i next-themes`, шрифты через next/font (§2.1), замена `globals.css` (§1.1), ThemeProvider в `src/app/layout.tsx` (§5.6.3), градиент фона. Проверить обе темы на текущем (еще не перекрашенном) UI — ничего не должно упасть.
2. **shadcn/ui**: `npx shadcn@latest init` + `add` (§4.1); после init вернуть палитру §1.1. Кастомные варианты Badge/Alert (§4.2). Компоненты копируются в `src/components/ui/`.
3. **Оболочка**: Logo, ThemeToggle, AppNav (верх + низ), Footer, auth-экраны — маленькие поверхности для обкатки токенов.
4. **Дашборд**: шапка с display-итогом → MetricCards → AllocationBar → SparklinePlaceholder → отделка PortfolioTable (десктоп + мобильные карточки) → баннеры/дисклеймер.
5. **Остальные экраны**: кошельки (AlertDialog!), цели и записи (мини-превью полосы), настройки + админ.
6. **Состояния и QA**: скелетоны, тосты, проход по чек-листу §8.3.

### 8.2. Технические указания

- **Next.js 16**: перед кодом сверяться с `node_modules/next/dist/docs/` (правило AGENTS.md) — конвенции могли измениться относительно привычных.
- **Tailwind 4**: конфиг-файла нет; всё — в `globals.css` через `@theme inline` (§1.1). Темная тема — `@custom-variant dark` + класс `.dark` на `<html>` (ставит next-themes).
- **shadcn init на Tailwind 4** определяет v4 автоматически; выбирать style «new-york», base color «neutral», CSS variables — yes. Сгенерированные токены заменить нашими — маппинг `@theme inline` оставить как в §1.1 (он совместим с компонентами shadcn).
- Категорийные тинты карточек — через `color-mix(in oklab, …)` в inline-стиле или arbitrary-классе; не плодить отдельные токены на каждый тинт.
- Тосты: `<Toaster />` монтируется в корневом layout один раз.

### 8.3. Что НЕ трогать (definition of done)

- `src/lib/format.ts` и все вызовы форматтеров: десятичная запятая, «$81 098», типографский минус, знаки `+`/`−`, точность знаков — как есть. Меняется только шрифт отображения (`font-mono`).
- API-слой (`src/lib/use-api.ts`, роуты), логика компонентов: debounce, stale-while-revalidate, автообновление 15 мин, порядок загрузки, условия рендера.
- Русские тексты — все существующие строки дословно (новые строки в этом ТЗ добавляются, старые не переформулируются).
- Доступность: `aria-expanded`, `aria-current`, `role="status"`, `role="alert"`, `aria-label` на иконках-кнопках, `scope` на th, `<label htmlFor>` — сохранить; инлайн-`role="alertdialog"` заменяется компонентом AlertDialog (семантика встроена).
- Никаких полей/упоминаний приватных ключей и сид-фраз (ТЗ §6.3) — дизайн ничего такого не добавляет.
- Чек-лист приемки: обе темы на всех экранах; 375px без горизонтального скролла; фокус видим на каждом интерактивном элементе; `prefers-reduced-motion` проверен; контраст ключевых пар — по таблицам §1.2; дашборд на кэше < 2с; Lighthouse a11y ≥ 95.

---

**UI Designer** · дизайн-система «Terminal Blue» v1.0 · готово к передаче в реализацию (задача №9)
