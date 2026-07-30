"use client";

import { useState } from "react";
import type { AssetRowDto } from "@/lib/api/types";
import {
  chainLabel,
  formatQuantity,
  formatQuantityFull,
  formatUsd,
} from "@/lib/format";

/**
 * Список активов с раскрытием в источники (кошелек x сеть) — S1.5.
 * Используется внутри строк корзин и в секциях «Нераспознанные»/«Скрытые».
 * Количества — десятичные строки: компактно 4 значащие цифры,
 * полное значение в title и в разбивке по источникам.
 */

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block text-[10px] text-gray-400 transition-transform ${
        open ? "rotate-90" : ""
      }`}
    >
      ▶
    </span>
  );
}

function AssetRow({ asset }: { asset: AssetRowDto }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-t border-gray-100 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${asset.symbol}: показать источники`}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-gray-900">
              {asset.symbol}
            </span>
            {asset.priceStale && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                цена устарела
              </span>
            )}
          </span>
          <span
            className="block text-xs tabular-nums text-gray-500"
            title={formatQuantityFull(asset.quantity)}
          >
            {formatQuantity(asset.quantity)}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-sm tabular-nums font-medium text-gray-900">
            {asset.valueUsd === null ? "—" : formatUsd(asset.valueUsd)}
          </span>
          <span className="block text-xs tabular-nums text-gray-500">
            {asset.priceUsd === null ? "нет цены" : formatUsd(asset.priceUsd)}
          </span>
        </span>
      </button>

      {open && (
        <ul className="bg-gray-50/60 pb-1">
          {asset.sources.map((s, i) => (
            <li
              key={`${s.walletId}-${s.chain}-${i}`}
              className="flex items-center gap-2 py-1.5 pl-9 pr-3 text-xs text-gray-600"
            >
              <span className="min-w-0 flex-1 truncate">
                {s.walletLabel ?? "Без метки"} · {chainLabel(s.chain)}
              </span>
              <span
                className="tabular-nums"
                title={formatQuantityFull(s.quantity)}
              >
                {formatQuantity(s.quantity)}
              </span>
              <span className="w-24 text-right tabular-nums text-gray-900">
                {s.valueUsd === null ? "—" : formatUsd(s.valueUsd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function AssetList({ assets }: { assets: AssetRowDto[] }) {
  if (assets.length === 0) return null;
  return (
    <ul>
      {assets.map((a) => (
        <AssetRow key={a.key} asset={a} />
      ))}
    </ul>
  );
}
