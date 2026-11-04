import { Bookmark, BookmarkCheck, ExternalLink } from "lucide-react";
import { NEWS_CATEGORY_LABELS } from "@/features/news/news-categories";
import { formatRelativeTimeFr } from "@/features/news/relative-time";
import { relevanceTone } from "@/features/news/relevance";
import type { NewsFeedItem } from "@/features/news/queries";
import { formatCurrency } from "@/lib/utils";

/** Libellé court d'un ticker Disnat (`BCE-C` → `BCE`). */
export function displayTickerLabel(ticker: string): string {
  return ticker.replace(/-(C|U|T)$/i, "");
}

const TONE_CLASS: Record<ReturnType<typeof relevanceTone>, string> = {
  high: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function NewsCard({
  item,
  onOpen,
  onToggleSave,
  saving = false,
}: {
  item: NewsFeedItem;
  onOpen?: (item: NewsFeedItem) => void;
  onToggleSave?: (item: NewsFeedItem) => void;
  saving?: boolean;
}) {
  const sourceLabel = item.publisher ?? item.source.name;
  const tone = relevanceTone(item.relevanceScore);

  return (
    <article
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 ${
        item.read ? "opacity-75" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">{sourceLabel}</span>
            <span aria-hidden>·</span>
            <time dateTime={item.publishedAt}>{formatRelativeTimeFr(item.publishedAt)}</time>
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium ring-1 ${TONE_CLASS[tone]}`}
              title={`Pertinence ${item.relevanceScore}/100`}
            >
              {NEWS_CATEGORY_LABELS[item.category]}
            </span>
            {item.tickers.map((ticker) => (
              <span
                key={ticker.ticker}
                className="inline-flex items-center rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white"
                title={`Correspondance ${ticker.matchKind.toLowerCase()} (${Math.round(
                  ticker.confidence * 100,
                )} %)`}
              >
                {displayTickerLabel(ticker.ticker)}
              </span>
            ))}
          </div>

          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => onOpen?.(item)}
            className="mt-1.5 block text-sm font-semibold leading-snug text-slate-950 hover:underline"
          >
            {item.title}
          </a>

          {item.excerpt ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">{item.excerpt}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
            {item.portfolioPct !== null && item.portfolioPct > 0 ? (
              <span className="font-medium text-cyan-700">
                Touche {item.portfolioPct.toLocaleString("fr-CA", { maximumFractionDigits: 1 })} % du
                portefeuille
                {item.portfolioValueCad !== null
                  ? ` · ${formatCurrency(item.portfolioValueCad, "CAD")}`
                  : ""}
              </span>
            ) : null}
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => onOpen?.(item)}
              className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
            >
              Ouvrir <ExternalLink className="size-3" />
            </a>
            {item.source.slug ? (
              <a
                href={`/nouvelles?source=${encodeURIComponent(item.source.slug)}`}
                className="text-slate-400 hover:text-slate-700"
              >
                via {item.source.name}
              </a>
            ) : null}
          </div>
        </div>

        {onToggleSave ? (
          <button
            type="button"
            onClick={() => onToggleSave(item)}
            disabled={saving}
            aria-pressed={item.saved}
            aria-label={item.saved ? "Retirer des sauvegardées" : "Sauvegarder"}
            className={`shrink-0 rounded-md p-1.5 transition-colors disabled:opacity-50 ${
              item.saved
                ? "bg-cyan-50 text-cyan-700"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            {item.saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
          </button>
        ) : null}
      </div>
    </article>
  );
}
