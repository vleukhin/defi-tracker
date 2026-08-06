import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Дизайн-код §5: фон --bg-sunken, обводка --line-card, высота 34,
        // в фокусе --accent + ring 3px --focus-ring. Плейсхолдер — --text-4.
        //
        // На тач-ширинах поле дорастает до 44px (§6) — здесь, в примитиве,
        // чтобы call-site'ы с собственной высотой (h-[30px]) тоже попадали
        // под палец: модификатор pointer-coarse их не перебивает.
        // text-base до md — обязателен: Safari увеличивает страницу при
        // фокусе на поле мельче 16px и обратно её не возвращает.
        "h-control w-full min-w-0 rounded-control border border-line-card bg-sunken px-3 text-base text-text-1 transition-colors duration-120 ease-out outline-none pointer-coarse:h-11 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-1 placeholder:text-text-4 focus-visible:border-[var(--accent)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-[13.5px]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
