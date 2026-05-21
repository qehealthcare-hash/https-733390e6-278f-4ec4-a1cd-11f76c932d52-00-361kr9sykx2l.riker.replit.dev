export function formatCurrency(value) {
  var numeric = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(numeric);
}

export function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

export function formatMonth(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "long"
  }).format(new Date(value));
}

export function slugToText(value) {
  return String(value || "")
    .toLowerCase()
    .split("_")
    .map(function (part) {
      return part ? part[0].toUpperCase() + part.slice(1) : "";
    })
    .join(" ");
}
