"use client";

import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Контент раскрытия: закрытый блок не участвует в tab order. */
export function Collapse({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-[var(--motion-fast)] ease-[var(--ease-standard)] starting:grid-rows-[0fr] starting:opacity-0">
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/** Общий disclosure для диагностических и вспомогательных деталей. */
export function Disclosure({
  title,
  summary,
  children,
  defaultOpen = false,
  className,
  contentClassName,
  id,
}: {
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const generatedId = useId();
  const disclosureId = id ?? `disclosure-${generatedId}`;
  const contentId = `${disclosureId}-content`;

  return (
    <div id={disclosureId} className={cn("group", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center gap-2 px-card py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-text-3 transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1">{title}</span>
        {summary}
      </button>
      <Collapse open={open}>
        <div id={contentId} className={contentClassName}>
          {children}
        </div>
      </Collapse>
    </div>
  );
}
