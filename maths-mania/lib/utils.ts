import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn — class name composer used across the codebase.
 * Combines clsx (conditional class logic) with tailwind-merge
 * (dedupes conflicting Tailwind utilities, last one wins).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format a number with Indian grouping (e.g. 1,23,456).
 */
export function formatIndianNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

/**
 * Format a number as a currency amount in INR (no decimals by default).
 */
export function formatINR(amount: number, withPaise = false): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: withPaise ? 2 : 0,
    maximumFractionDigits: withPaise ? 2 : 0,
  }).format(amount);
}

/**
 * Strict assertion helper for narrowing in TS. Throws at runtime
 * if the value is null/undefined — useful in server actions where
 * we know an env var must exist.
 */
export function assert<T>(
  value: T | null | undefined,
  message: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}
