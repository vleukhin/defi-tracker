/**
 * Резолвер алиаса `@/` для скриптов, запускаемых напрямую в Node.
 *
 * Зачем. Скрипты до сих пор не трогали код приложения: сид и бэкфилл ходили
 * в Supabase сами. Восстановление снепшота — наоборот, обязано считать
 * портфель ТЕМ ЖЕ кодом, что и приложение, иначе восстановленная точка
 * считалась бы по вторым правилам и расходилась бы с остальной историей.
 * А этот код весь написан через `@/lib/...` — алиас из tsconfig, про который
 * Node ничего не знает.
 *
 * Типы снимает сам Node (strip-types по умолчанию с 23-й версии), так что
 * сборщик и лишние зависимости не нужны — только отображение путей.
 */
import { statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolvePath(ROOT, "src");
const SCRIPTS = resolvePath(ROOT, "scripts");

/** Порядок проб — тот же, что у TypeScript: сам файл, затем index каталога. */
const SUFFIXES = ["", ".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx"];

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * Первый существующий файл из `base` + каждый суффикс; null — ни одного.
 *
 * `format: "module"` проставляется явно: у package.json нет "type", и без
 * подсказки Node сначала пробует разобрать .ts как CommonJS, спотыкается об
 * import и переразбирает уже как модуль — с предупреждением на каждый файл.
 */
function probe(base) {
  const found = SUFFIXES.map((suffix) => `${base}${suffix}`).find(isFile);
  if (!found) return null;
  return {
    url: pathToFileURL(found).href,
    // Формат называется только для .ts: это и включает снятие типов, а заодно
    // избавляет от разбора файла сперва как CommonJS. Для .js формат НЕ
    // навязывается — пусть Node решает сам, иначе первый же CommonJS-модуль
    // чужого пакета получит ESM-обёртку и упадёт на `exports`
    ...(/\.tsx?$/.test(found) ? { format: "module-typescript" } : {}),
    shortCircuit: true,
  };
}

/** Наш ли это исходник: только им дописываются расширения. */
const isOurs = (path) => path.startsWith(SRC) || path.startsWith(SCRIPTS);

export function resolve(specifier, context, nextResolve) {
  // Маркер «только для сервера» бросает исключение из своей точки входа по
  // умолчанию и молчит под условием экспорта `react-server`, которое ставит
  // Next. Скрипт — серверный код по определению, поэтому берём ту же ветку:
  // иначе ни один модуль приложения отсюда не импортировать вовсе.
  if (specifier === "server-only") {
    return nextResolve(specifier, {
      ...context,
      conditions: ["react-server", ...context.conditions],
    });
  }

  if (specifier.startsWith("@/")) {
    const base = resolvePath(SRC, specifier.slice(2));
    const hit = probe(base);
    if (hit) return hit;
    throw new Error(`alias-loader: не найден модуль для ${specifier} (искали ${base})`);
  }

  // Относительные импорты в исходниках написаны БЕЗ расширения («./config») —
  // так их разрешает TypeScript и так принято во всём проекте. Node по
  // спецификации ESM расширение не домысливает, поэтому достраиваем здесь же:
  // иначе алиас работал бы, а первый же относительный импорт внутри — нет.
  //
  // Только для своих файлов: внутри node_modules относительные импорты уже
  // с расширениями, и вмешательство там означало бы навязанный формат чужому
  // CommonJS-пакету.
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parent = fileURLToPath(context.parentURL);
    if (isOurs(parent)) {
      const hit = probe(resolvePath(dirname(parent), specifier));
      if (hit) return hit;
    }
  }

  return nextResolve(specifier, context);
}
