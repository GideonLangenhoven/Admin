import { format, isValid, parse } from "date-fns";

export function parseDateInput(value: string): string | null {
  const text = value.trim().replace(/\s+/g, " ").replace(/\./g, "/");
  if (!/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2} [a-z]+ \d{4})$/i.test(text)) return null;
  for (const pattern of ["yyyy-MM-dd", "d/M/yyyy", "d MMM yyyy", "d MMMM yyyy"]) {
    const date = parse(text, pattern, new Date(2000, 0, 1));
    if (isValid(date)) return format(date, "yyyy-MM-dd");
  }
  return null;
}
