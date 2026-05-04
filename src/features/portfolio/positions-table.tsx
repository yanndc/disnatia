"use client";

import { useMemo, useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import type { EnrichedPosition } from "@/features/portfolio/queries";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

export function PositionsTable({ positions }: { positions: EnrichedPosition[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "displayMarketValue", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo<ColumnDef<EnrichedPosition>[]>(
    () => [
      {
        accessorKey: "ticker",
        header: "Ticker",
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-slate-950">{row.original.ticker}</p>
            <p className="text-xs text-slate-500">{row.original.securityName}</p>
            {row.original.usesLiveQuote ? (
              <p className="text-[10px] uppercase tracking-wide text-emerald-700">cours live</p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "accountName",
        header: "Compte",
        cell: ({ row }) => (
          <div>
            <p>{row.original.accountName}</p>
            {row.original.accountNumber ? (
              <p className="text-xs text-slate-500">#{row.original.accountNumber}</p>
            ) : null}
          </div>
        ),
      },
      { accessorKey: "currency", header: "Devise" },
      {
        accessorKey: "quantity",
        header: "Quantité",
        cell: ({ row }) => formatNumber(row.original.quantity, 4),
      },
      {
        accessorKey: "averageCost",
        header: "Coût moyen",
        cell: ({ row }) =>
          row.original.averageCost === null
            ? "-"
            : formatCurrency(row.original.averageCost, row.original.currency),
      },
      {
        accessorKey: "displayPrice",
        header: "Prix affiché",
        cell: ({ row }) =>
          row.original.displayPrice === null
            ? "-"
            : formatCurrency(row.original.displayPrice, row.original.currency),
      },
      {
        accessorKey: "displayMarketValue",
        header: "Valeur affichée",
        cell: ({ row }) =>
          formatCurrency(row.original.displayMarketValue, row.original.currency),
      },
      {
        accessorKey: "disnatMarketValue",
        header: "Valeur import",
        cell: ({ row }) =>
          formatCurrency(row.original.disnatMarketValue, row.original.currency),
      },
      {
        accessorKey: "weightPct",
        header: "Poids",
        cell: ({ row }) =>
          row.original.weightPct === null ? "-" : formatPercent(row.original.weightPct),
      },
      {
        accessorKey: "unrealizedGainLoss",
        header: "Gain/perte",
        cell: ({ row }) =>
          row.original.unrealizedGainLoss === null
            ? "-"
            : formatCurrency(row.original.unrealizedGainLoss, row.original.currency),
      },
    ],
    [],
  );

  // TanStack Table intentionally returns callable table helpers.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: positions,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Input
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder="Rechercher ticker, nom, compte ou devise..."
          className="md:max-w-md"
        />
        <p className="text-sm text-slate-500">
          {table.getFilteredRowModel().rows.length} positions affichées
        </p>
      </div>
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1200px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="cursor-pointer px-3 py-3 font-medium"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{
                      asc: " ↑",
                      desc: " ↓",
                    }[header.column.getIsSorted() as string] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-3 text-slate-700">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {positions.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            Aucune position. Importe un fichier Disnat pour remplir la table.
          </p>
        ) : null}
      </div>
    </div>
  );
}
