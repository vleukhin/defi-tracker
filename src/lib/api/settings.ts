import "server-only";
import { z } from "zod";

/**
 * Настройки пользователя (Фаза 4). Пока одно поле — порог предупреждения
 * по health factor (S4.1/S4.3).
 *
 * Границы: строго больше 1 (порог ≤ 1 означал бы «предупреждать после
 * ликвидации») и не больше 10 (выше HF в осмысленных стратегиях не живет,
 * а опечатка вроде 15 вместо 1.5 превратила бы индикатор в вечную тревогу).
 */
export const DEFAULT_HF_WARNING_THRESHOLD = 1.5;

export const settingsSchema = z.object({
  hfWarningThreshold: z
    .number()
    .gt(1, "Порог должен быть больше 1")
    .max(10, "Порог не больше 10"),
});

export type SettingsInput = z.infer<typeof settingsSchema>;
