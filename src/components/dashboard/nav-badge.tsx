export function NavBadge({ count, label }: { count?: number; label?: string }) {
  if (!count || count <= 0) return null;
  return (
    <span
      title={label}
      aria-label={label}
      className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-800"
    >
      {count}
    </span>
  );
}
