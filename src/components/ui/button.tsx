import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Дизайн-код §5: высота 34, радиус 8, переходы только по цвету и фону.
  // Одна primary-кнопка на экран, и только на создающее действие.
  "group/button inline-flex shrink-0 items-center justify-center rounded-control border border-transparent bg-clip-padding text-[13.5px] font-medium whitespace-nowrap transition-colors duration-120 ease-out outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[var(--accent-hover)]",
        // Дизайн-код зовёт это ghost: обводка --line-strong, фона нет
        outline:
          "border-line-strong bg-transparent text-text-1 hover:border-line-hover hover:bg-raised aria-expanded:bg-raised",
        secondary:
          "bg-raised text-text-1 hover:bg-raised-hover aria-expanded:bg-raised-hover",
        ghost:
          "text-text-2 hover:bg-chip hover:text-text-1 aria-expanded:bg-chip aria-expanded:text-text-1",
        // danger: текст цветом --loss, фон появляется только на hover
        destructive:
          "bg-transparent text-loss hover:bg-[color-mix(in_srgb,var(--loss)_10%,transparent)] focus-visible:ring-destructive/30",
        link: "text-link underline-offset-4 hover:underline",
      },
      // Высоты 24–38px — плотность десктопа. На тач-ширинах каждая дорастает
      // до 44px: дизайн-код §6 требует hit-зону не меньше 44, а мимо пальца
      // промахивались все кнопки приложения разом. Растягиваем сам контрол,
      // как Segmented и FilterChips; псевдоэлемент (приём HelpTip) оставлен
      // тем случаям, где знак обязан остаться крошечным внутри строки текста.
      size: {
        default:
          "h-control gap-1.5 px-3.5 pointer-coarse:h-11 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 rounded-pill px-2 text-[12px] pointer-coarse:h-11 pointer-coarse:px-3 [&_svg:not([class*='size-'])]:size-3 pointer-coarse:[&_svg:not([class*='size-'])]:size-4",
        sm: "h-[30px] gap-1.5 px-3 text-[12.5px] pointer-coarse:h-11 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        lg: "h-[38px] gap-1.5 px-5 text-sm pointer-coarse:h-11 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-control pointer-coarse:size-11",
        "icon-xs":
          "size-6 rounded-pill pointer-coarse:size-11 [&_svg:not([class*='size-'])]:size-3 pointer-coarse:[&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-[30px] pointer-coarse:size-11",
        "icon-lg": "size-[38px] pointer-coarse:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
