import Link from "next/link";
import { ArrowRight, Newspaper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { displayTickerLabel } from "@/features/news/news-card";
import { getNewsHighlights } from "@/features/news/queries";
import { formatRelativeTimeFr } from "@/features/news/relative-time";

/**
 * Widget de la vue d'ensemble : uniquement les nouvelles qui touchent un titre détenu,
 * triées par score de pertinence (exposition $ + fraîcheur + force du rattachement).
 */
export async function PortfolioNewsHighlights() {
  const items = await getNewsHighlights(4).catch(() => []);
  if (items.length === 0) return null;

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950">
            <Newspaper className="size-4 text-cyan-600" />
            Nouvelles qui touchent vos positions
          </h2>
          <Link
            href="/nouvelles"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            Tout le fil <ArrowRight className="size-3" />
          </Link>
        </div>

        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                <span className="font-medium text-slate-600">{item.publisher ?? item.source.name}</span>
                <span aria-hidden>·</span>
                <time dateTime={item.publishedAt}>{formatRelativeTimeFr(item.publishedAt)}</time>
                {item.portfolioPct !== null && item.portfolioPct > 0 ? (
                  <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 font-medium text-cyan-700 ring-1 ring-cyan-100">
                    {item.portfolioPct.toLocaleString("fr-CA", { maximumFractionDigits: 1 })} % du
                    portefeuille
                  </span>
                ) : null}
                {item.tickers.slice(0, 4).map((ticker) => (
                  <span
                    key={ticker.ticker}
                    className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white"
                  >
                    {displayTickerLabel(ticker.ticker)}
                  </span>
                ))}
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1 block text-sm leading-snug text-slate-800 hover:underline"
              >
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
