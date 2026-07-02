"use client";

import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";

export type NonFinancialAssetDto = {
  id: string;
  assetKey: string;
  assetType: "REAL_ESTATE" | "VEHICLE" | "PRIVATE_BUSINESS" | "OTHER";
  displayLabel: string;
  owner: string | null;
  currency: string;
  isActive: boolean;
  metadata: unknown;
  snapshotCount: number;
  latestSnapshot: {
    asOfDate: string;
    marketValue: number;
    mortgageBalance: number;
    netEquity: number;
  } | null;
};

const numNonNeg = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? 0 : Number(v)),
  z.number().finite().nonnegative(),
);

const createSchema = z.object({
  assetType: z.enum(["REAL_ESTATE", "VEHICLE", "PRIVATE_BUSINESS", "OTHER"]),
  displayLabel: z.string().min(1, "Nom requis").max(240),
  owner: z.string().max(200).optional(),
  coOwner: z.string().max(200).optional(),
  coOwnerSharePct: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? 0 : Number(v)),
    z.number().finite().min(0).max(100),
  ),
  currency: z.enum(["CAD", "USD"]),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  marketValue: numNonNeg,
  mortgageBalance: numNonNeg,
  notes: z.string().max(2000).optional(),
}).refine((v) => v.mortgageBalance <= v.marketValue, {
  message: "L'hypothèque ne peut pas dépasser la valeur.",
  path: ["mortgageBalance"],
}).refine((v) => {
  const hasCoOwner = Boolean(v.coOwner?.trim());
  if (!hasCoOwner) return true;
  return Boolean(v.owner?.trim()) && v.coOwnerSharePct > 0 && v.coOwnerSharePct < 100;
}, {
  message: "Avec un 2e copropriétaire, renseigne aussi le copropriétaire 1 et une part entre 0 et 100.",
  path: ["coOwnerSharePct"],
});

type CreateForm = z.infer<typeof createSchema>;

const snapshotSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  marketValue: numNonNeg,
  mortgageBalance: numNonNeg,
  notes: z.string().max(2000).optional(),
}).refine((v) => v.mortgageBalance <= v.marketValue, {
  message: "L'hypothèque ne peut pas dépasser la valeur.",
  path: ["mortgageBalance"],
});

type SnapshotForm = z.infer<typeof snapshotSchema>;

function defaults(): CreateForm {
  return {
    assetType: "REAL_ESTATE",
    displayLabel: "Maison",
    owner: "",
    coOwner: "",
    coOwnerSharePct: 50,
    currency: "CAD",
    asOfDate: new Date().toISOString().slice(0, 10),
    marketValue: 0,
    mortgageBalance: 0,
    notes: "",
  };
}

function assetTypeLabel(type: NonFinancialAssetDto["assetType"]) {
  if (type === "REAL_ESTATE") return "Immobilier";
  if (type === "VEHICLE") return "Véhicule";
  if (type === "PRIVATE_BUSINESS") return "Entreprise privée";
  return "Autre";
}

export function NonFinancialAssetsPanel({
  initialAssets,
}: {
  initialAssets: NonFinancialAssetDto[];
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [msg, setMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const createForm = useForm<CreateForm>({
    resolver: zodResolver(createSchema) as Resolver<CreateForm>,
    defaultValues: defaults(),
  });

  async function refreshAssets() {
    try {
      const r = await fetch("/api/non-financial-assets");
      const data = (await r.json()) as { assets?: NonFinancialAssetDto[] };
      if (data.assets) setAssets(data.assets);
    } catch {
      /* ignore */
    }
  }

  async function create(values: CreateForm) {
    setMsg(null);
    const res = await fetch("/api/non-financial-assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetType: values.assetType,
        displayLabel: values.displayLabel.trim(),
        owner: values.owner?.trim() || null,
        coOwners:
          values.coOwner?.trim()
            ? [{ owner: values.coOwner.trim(), sharePct: values.coOwnerSharePct }]
            : [],
        currency: values.currency,
        initialSnapshot: {
          asOfDate: values.asOfDate,
          marketValue: values.marketValue,
          mortgageBalance: values.mortgageBalance,
          notes: values.notes?.trim() || null,
        },
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(typeof payload.error === "string" ? payload.error : "Création impossible.");
      return;
    }
    setMsg("Actif ajouté.");
    createForm.reset(defaults());
    await refreshAssets();
  }

  async function remove(id: string) {
    setDeletingId(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/non-financial-assets/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setMsg("Suppression impossible.");
        return;
      }
      await refreshAssets();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card className="border-amber-200/80 bg-amber-50/30">
      <CardHeader>
        <CardTitle className="text-base text-slate-900">Actifs non-boursiers (patrimoine)</CardTitle>
        <p className="text-sm text-slate-600">
          Exemple: maison. On saisit valeur marchande et hypothèque pour calculer l’équité nette.
          Ces montants entrent dans le patrimoine total, pas dans la performance portefeuille.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {msg ? (
          <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">{msg}</p>
        ) : null}

        {assets.length > 0 ? (
          <ul className="space-y-3 text-sm">
            {assets.map((asset) => (
              <li key={asset.id} className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm">
                <AssetCard asset={asset} deletingId={deletingId} onDelete={remove} onSaved={refreshAssets} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Aucun actif non-boursier pour l’instant.</p>
        )}

        <div className="rounded-xl border border-dashed border-amber-300 bg-white/80 p-4">
          <p className="mb-3 text-sm font-medium text-slate-800">Ajouter un actif non-boursier</p>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={createForm.handleSubmit((v) => void create(v))}>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Type</span>
              <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" {...createForm.register("assetType")}> 
                <option value="REAL_ESTATE">Immobilier</option>
                <option value="VEHICLE">Véhicule</option>
                <option value="PRIVATE_BUSINESS">Entreprise privée</option>
                <option value="OTHER">Autre</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Libellé</span>
              <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" {...createForm.register("displayLabel")} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Copropriétaire 1</span>
              <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Ex. Yann de Champlain" {...createForm.register("owner")} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Copropriétaire 2 (optionnel)</span>
              <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Ex. Valérie Degrandpré" {...createForm.register("coOwner")} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Devise</span>
              <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" {...createForm.register("currency")}>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Part du copropriétaire 2 (%)</span>
              <input type="number" step="0.01" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" {...createForm.register("coOwnerSharePct")} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Date du relevé</span>
              <input type="date" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" {...createForm.register("asOfDate")} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Valeur marchande</span>
              <input type="number" step="0.01" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" {...createForm.register("marketValue")} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Hypothèque</span>
              <input type="number" step="0.01" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" {...createForm.register("mortgageBalance")} />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
              <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" {...createForm.register("notes")} />
            </label>
            {createForm.formState.errors.mortgageBalance ? (
              <p className="sm:col-span-2 text-sm text-red-600">{createForm.formState.errors.mortgageBalance.message}</p>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit">Créer l’actif</Button>
            </div>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

function AssetCard({
  asset,
  deletingId,
  onDelete,
  onSaved,
}: {
  asset: NonFinancialAssetDto;
  deletingId: string | null;
  onDelete: (id: string) => void;
  onSaved: () => void | Promise<void>;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{asset.displayLabel}</p>
          <p className="text-xs text-slate-500">
            {assetTypeLabel(asset.assetType)} · {asset.currency}
            {asset.owner ? (
              <>
                {" "}· <span className="font-medium text-slate-700">{sanitizePortfolioOwner(asset.owner) ?? asset.owner}</span>
              </>
            ) : null}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-400">{asset.assetKey}</p>
        </div>
        <div className="text-right">
          {asset.latestSnapshot ? (
            <>
              <p className="tabular-nums font-semibold text-slate-900">{formatCurrency(asset.latestSnapshot.netEquity, asset.currency)}</p>
              <p className="text-xs text-slate-500">Équité au {asset.latestSnapshot.asOfDate}</p>
            </>
          ) : (
            <p className="text-amber-700">Aucun snapshot</p>
          )}
        </div>
      </div>

      {asset.latestSnapshot ? (
        <p className="mt-2 text-xs text-slate-600">
          Valeur: {formatCurrency(asset.latestSnapshot.marketValue, asset.currency)} · Hypothèque: {formatCurrency(asset.latestSnapshot.mortgageBalance, asset.currency)}
        </p>
      ) : null}

      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="text-xs font-medium text-slate-700">Ajouter une mise à jour</p>
        <div className="mt-2">
          <AssetSnapshotInlineForm assetId={asset.id} currency={asset.currency} onSaved={onSaved} />
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="mt-3 h-9 text-red-700"
        disabled={deletingId === asset.id}
        onClick={() => void onDelete(asset.id)}
      >
        {deletingId === asset.id ? "Suppression..." : "Supprimer cet actif"}
      </Button>
    </>
  );
}

function AssetSnapshotInlineForm({
  assetId,
  currency,
  onSaved,
}: {
  assetId: string;
  currency: string;
  onSaved: () => void | Promise<void>;
}) {
  const form = useForm<SnapshotForm>({
    resolver: zodResolver(snapshotSchema) as Resolver<SnapshotForm>,
    defaultValues: {
      asOfDate: new Date().toISOString().slice(0, 10),
      marketValue: 0,
      mortgageBalance: 0,
      notes: "",
    },
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(values: SnapshotForm) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/non-financial-assets/${assetId}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asOfDate: values.asOfDate,
          marketValue: values.marketValue,
          mortgageBalance: values.mortgageBalance,
          notes: values.notes?.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof payload.error === "string" ? payload.error : "Échec.");
        return;
      }
      setMsg("Snapshot enregistré.");
      form.reset({
        asOfDate: new Date().toISOString().slice(0, 10),
        marketValue: 0,
        mortgageBalance: 0,
        notes: "",
      });
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-2 text-xs" onSubmit={form.handleSubmit(submit)}>
      <label>
        <span className="mb-0.5 block text-slate-500">Date</span>
        <input type="date" className="rounded border border-slate-300 px-2 py-1" {...form.register("asOfDate")} />
      </label>
      <label>
        <span className="mb-0.5 block text-slate-500">Valeur</span>
        <input type="number" step="0.01" className="w-24 rounded border border-slate-300 px-2 py-1" {...form.register("marketValue")} />
      </label>
      <label>
        <span className="mb-0.5 block text-slate-500">Hypothèque</span>
        <input type="number" step="0.01" className="w-24 rounded border border-slate-300 px-2 py-1" {...form.register("mortgageBalance")} />
      </label>
      <label className="min-w-[8rem] flex-1">
        <span className="mb-0.5 block text-slate-500">Note</span>
        <input className="w-full rounded border border-slate-300 px-2 py-1" {...form.register("notes")} />
      </label>
      <Button type="submit" className="h-8 px-3 text-xs" variant="secondary" disabled={busy}>
        {busy ? "…" : "Ajouter"}
      </Button>
      <span className="text-slate-500">{currency}</span>
      {msg ? <span className="text-slate-700">{msg}</span> : null}
    </form>
  );
}
