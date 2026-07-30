"use client";

import { Check, Moon, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const THEME_OPTIONS = [
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Темная" },
  { value: "system", label: "Системная" },
] as const;

const emptySubscribe = () => () => {};

/**
 * Переключатель темы (ТЗ §5.6.3): ghost-иконка Sun/Moon 20px + DropdownMenu.
 * До гидрации — нейтральный SunMoon (тема неизвестна на сервере).
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  // true после гидрации, false в SSR — без setState в эффекте
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const Icon = !mounted ? SunMoon : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Переключить тему"
          className="text-muted-foreground hover:text-foreground"
        >
          <Icon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEME_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
          >
            {option.label}
            {mounted && theme === option.value && (
              <Check className="ml-auto size-4" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
