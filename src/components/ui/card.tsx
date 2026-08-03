import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Поверхность карточки (дизайн-код §5): радиус 14, обводка --line-card,
 * фон --bg-surface. Тени нет ни в одной теме — тень только у всплывающих
 * слоёв (§9), глубину задаёт тон поверхности.
 *
 * Новый код берёт `DcCard` из @/components/dc/card: там же живут поля 18
 * и hover-состояние. Этот примитив остаётся ради shadcn-совместимости.
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-card border border-line-card bg-surface text-sm text-card-foreground",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1 px-4 pt-4", className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-sm font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("p-4", className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-4 pb-4", className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
