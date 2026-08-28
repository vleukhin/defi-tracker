"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

/** Поле пароля с доступным переключателем видимости. */
export function PasswordInput({
  className,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={cn("pr-11", className)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-control text-text-3 outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:text-text-1 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
