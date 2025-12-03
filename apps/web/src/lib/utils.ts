import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(num: number, decimals = 2): string {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(decimals) + "B";
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(decimals) + "M";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(decimals) + "K";
  }
  return num.toFixed(decimals);
}

export function formatPrice(price: number): string {
  const absPrice = Math.abs(price);

  // Handle larger values (like price changes)
  if (absPrice >= 1000) {
    return price.toFixed(0);
  }
  if (absPrice >= 100) {
    return price.toFixed(1);
  }
  if (absPrice >= 1) {
    return price.toFixed(2);
  }
  if (absPrice >= 0.01) {
    return price.toFixed(4);
  }
  if (absPrice >= 0.0001) {
    return price.toFixed(6);
  }
  if (absPrice >= 0.00000001) {
    return price.toFixed(8);
  }
  // Only use scientific notation for extremely small values
  if (absPrice > 0) {
    return price.toExponential(2);
  }
  return "0.00";
}

export function formatPercent(percent: number): string {
  const sign = percent >= 0 ? "+" : "";
  return sign + percent.toFixed(2) + "%";
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
