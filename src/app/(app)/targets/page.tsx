import type { Metadata } from "next";
import { PageHeader } from "@/components/dc/page-header";
import { TargetsManager } from "@/components/portfolio/targets-manager";

export const metadata: Metadata = { title: "Цели и записи" };

/**
 * «Цели и записи» — три карточки: целевые доли, монеты вручную, внесено.
 * Состав и данные держит клиентский корень TargetsManager: портфель нужен
 * всем трём (доли, стоимости записей, прибыль), и читается он один раз.
 */
export default function TargetsPage() {
  return (
    <>
      <PageHeader
        title="Цели и записи"
        meta="целевые доли, ручные монеты и внесённые деньги"
      />
      <TargetsManager />
    </>
  );
}
