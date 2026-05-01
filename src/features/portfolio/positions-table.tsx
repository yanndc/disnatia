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
import { Input } from "@/components/ui/input";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

type PositionRow = {
  id: string;
  ticker: string;
  securityName: string | null;
  accountName: string;
  currency: string;
  quantity: number;
  averageCost: number | null;
  marketPrice: number | null;
  marketValue: number;
  weightPct: number | null;
  unrealizedGainLoss: number | null;
};

export function PositionsTable({ positions }: { positions: PositionRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "marketValue", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo<ColumnDef<PositionRow>[]>(
    () => [
      {
        accessorKey: "ticker",
        header: "Ticker",
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-slate-950">{row.original.ticker}</p>
            <p className="text-xs text-slate-500">{row.original.securityName}</p>
          </div>
        ),
      },
      { accessorKey: "accountName", header: "Compte" },
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
        accessorKey: "marketPrice",
        header: "Prix",
        cell: ({ row }) =>
          row.original.marketPrice === null
            ? "-"
            : formatCurrency(row.original.marketPrice, row.original.currency),
      },
      {
        accessorKey: "marketValue",
        header: "Valeur",
        cell: ({ row }) =>
          formatCurrency(row.original.marketValue, row.original.currency),
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
        <table className="w-full min-w-[1100px] text-left text-sm">
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
            Aucune position. Importe un CSV Disnat pour remplir la table.
          </p>
        ) : null}
      </div>
    </div>
  );
}
