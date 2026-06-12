export function formatCurrency(value: unknown): string {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(numeric);
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(value as string | number);
}

export function formatDate(value: unknown): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(toDate(value));
}

export function formatMonth(value: unknown): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "long"
  }).format(toDate(value));
}

export function slugToText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .split("_")
    .map(function (part) {
      return part ? (part[0] || "").toUpperCase() + part.slice(1) : "";
    })
    .join(" ");
}
