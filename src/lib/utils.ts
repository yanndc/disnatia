import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency = "CAD") {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("fr-CA", {
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format((Number.isFinite(value) ? value : 0) / 100);
}
