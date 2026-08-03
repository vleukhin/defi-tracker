"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Segmented } from "@/components/dc/segmented";

/**
 * Тема — сегментированный переключатель (README §9): Светлая / Тёмная /
 * Системная. Значение хранит next-themes: класс и data-theme ставятся на
 * <html>, выбор переживает перезагрузку.
 */

type ThemeValue = "light" | "dark" | "system";

const THEME_OPTIONS: { value: ThemeValue; label: string }[] = [
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
  { value: "system", label: "Системная" },
];

/** Тема по умолчанию в ThemeProvider — до гидрации показываем её. */
const SSR_THEME: ThemeValue = "dark";

const emptySubscribe = () => () => {};

export function ThemeRow() {
  const { theme, setTheme } = useTheme();
  // На сервере активный пункт неизвестен — берётся дефолт провайдера
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const value: ThemeValue =
    mounted && theme ? (theme as ThemeValue) : SSR_THEME;

  return (
    <Segmented
      options={THEME_OPTIONS}
      value={value}
      onChange={setTheme}
      ariaLabel="Выбор темы"
    />
  );
}
