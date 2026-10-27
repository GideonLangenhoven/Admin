// The one ZAR display format: R1 200,00. CSV exports and API payloads keep plain 1200.00.
export function formatZar(amount: number) {
  return "R" + amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
