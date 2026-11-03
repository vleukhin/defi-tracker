/**
 * Подключает резолвер алиаса `@/` (alias-loader.mjs) к текущему процессу.
 *
 * Отдельный файл, потому что хуки загрузки обязаны отработать до первого
 * `import` скрипта, а значит подключаются через `--import`, а не из самого
 * скрипта. `registerHooks` вместо `register`: хук синхронный, отдельный
 * поток загрузчика ему не нужен, а `register` объявлен устаревшим.
 */
import { registerHooks } from "node:module";
import { resolve } from "./alias-loader.mjs";

registerHooks({ resolve });
