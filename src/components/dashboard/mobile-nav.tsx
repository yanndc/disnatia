"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { DashboardNavItem } from "./dashboard-navigation";
import { dashboardNavIcons } from "./dashboard-nav-icons";

export function MobileNav({ items }: { items: DashboardNavItem[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="inline-flex size-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
        aria-expanded={open}
        aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {open && mounted
        ? createPortal(
            <div className="fixed inset-0 z-[100] lg:hidden">
              <button
                type="button"
                className="absolute inset-0 bg-slate-950/40 backdrop-blur-[1px]"
                aria-label="Fermer le menu"
                onClick={() => setOpen(false)}
              />
              <aside className="relative z-10 flex h-full w-[min(18rem,88vw)] flex-col border-r border-slate-200 bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-950">Navigation</p>
                  <button
                    type="button"
                    className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                    aria-label="Fermer"
                    onClick={() => setOpen(false)}
                  >
                    <X className="size-5" />
                  </button>
                </div>
                <nav className="flex-1 overflow-y-auto p-3">
                  <ul className="space-y-1">
                    {items.map((item) => {
                      const Icon = dashboardNavIcons[item.icon];
                      const active =
                        pathname === item.href ||
                        (item.href !== "/overview" && pathname.startsWith(item.href));
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                              active
                                ? "bg-slate-950 text-white"
                                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                            }`}
                          >
                            <Icon className="size-4 shrink-0" />
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              </aside>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
