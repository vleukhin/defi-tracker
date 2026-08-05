#!/usr/bin/env node
/**
 * Печать руководства пользователя в PDF.
 *
 * Источник — docs/10-rukovodstvo-polzovatelya.html: обычная страница,
 * которую можно открыть в браузере. Перед печатью блок между маркерами
 * <!--FONTS--> и <!--/FONTS--> заменяется на @font-face с зашитыми
 * base64-подмножествами IBM Plex: печать идёт офлайн, и ссылка на Google
 * Fonts дала бы в PDF системный шрифт вместо шрифта дизайн-кода.
 *
 *   node scripts/build-guide-pdf.mjs
 *
 * Chromium берётся из PLAYWRIGHT_BROWSERS_PATH или из CHROME_PATH.
 * Кэш шрифтов кладётся в .cache/plex-fonts.css и переиспользуется.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "docs", "10-rukovodstvo-polzovatelya.html");
const OUTPUT = join(root, "docs", "10-rukovodstvo-polzovatelya.pdf");
const FONT_CACHE = join(root, ".cache", "plex-fonts.css");

const FONT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600" +
  "&family=IBM+Plex+Sans:wght@400;450;500;600&display=swap";

/** Подмножества, которые реально нужны русскому тексту с латиницей. */
const SUBSETS = new Set(["latin", "latin-ext", "cyrillic"]);

/** Google отдаёт woff2 только современным клиентам. */
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

async function buildFontCss() {
  if (existsSync(FONT_CACHE)) return readFileSync(FONT_CACHE, "utf8");

  const css = await (await fetch(FONT_CSS_URL, { headers: { "User-Agent": UA } })).text();
  const faces = [];
  const seen = new Set();

  // Блоки в ответе Google идут как «/* subset */ @font-face { … }»
  for (const block of css.split("/*").slice(1)) {
    const subset = block.split("*/")[0].trim();
    if (!SUBSETS.has(subset)) continue;

    const family = /font-family: '([^']+)'/.exec(block)?.[1];
    const weight = /font-weight: (\d+)/.exec(block)?.[1];
    const url = /url\((https:\/\/[^)]+)\)/.exec(block)?.[1];
    const range = /unicode-range: ([^;]+);/.exec(block)?.[1];
    if (!family || !weight || !url || !range) continue;

    // Sans приходит переменным начертанием: один файл на все веса, и
    // повторять его четырежды значило бы утроить размер PDF
    if (seen.has(url)) continue;
    seen.add(url);

    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    const weights = family === "IBM Plex Sans" ? "400 600" : weight;
    faces.push(
      `@font-face{font-family:'${family}';font-style:normal;` +
        `font-weight:${weights};` +
        `src:url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2');` +
        `unicode-range:${range};}`,
    );
  }

  const out = faces.join("\n");
  mkdirSync(dirname(FONT_CACHE), { recursive: true });
  writeFileSync(FONT_CACHE, out);
  return out;
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  const candidates = [
    join(base, "chromium-1194", "chrome-linux", "chrome"),
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "Chromium не найден — укажите путь в CHROME_PATH или PLAYWRIGHT_BROWSERS_PATH",
    );
  }
  return found;
}

const html = readFileSync(SOURCE, "utf8");
const fonts = await buildFontCss();
const printable = html.replace(
  /<!--FONTS-->[\s\S]*?<!--\/FONTS-->/,
  `<style>\n${fonts}\n</style>`,
);

const tmp = join(root, ".cache", "guide-print.html");
mkdirSync(dirname(tmp), { recursive: true });
writeFileSync(tmp, printable);

execFileSync(
  chromePath(),
  [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--no-pdf-header-footer",
    // Без бюджета печать иногда уходит раньше, чем декодируются зашитые
    // woff2, и в PDF попадают пустые глифы вместо текста
    "--virtual-time-budget=20000",
    "--run-all-compositor-stages-before-draw",
    `--print-to-pdf=${OUTPUT}`,
    tmp,
  ],
  { stdio: "inherit" },
);

console.log(`PDF: ${OUTPUT}`);
