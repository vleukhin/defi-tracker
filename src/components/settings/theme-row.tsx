"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const THEME_OPTIONS = [
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Темная" },
  { value: "system", label: "Системная" },
] as const;

const emptySubscribe = () => () => {};

/**
 * Сегментный контрол темы в настройках (ТЗ §5.4): дублирует переключатель
 * из шапки — на мобильных это основная точка входа.
 */
export function ThemeRow() {
  const { theme, setTheme } = useTheme();
  // До гидрации активный пункт неизвестен — все кнопки ghost
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  return (
    <div
      role="group"
      aria-label="Выбор темы"
      className="flex flex-wrap gap-1"
    >
      {THEME_OPTIONS.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={mounted && theme === option.value ? "secondary" : "ghost"}
          onClick={() => setTheme(option.value)}
          aria-pressed={mounted ? theme === option.value : undefined}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
