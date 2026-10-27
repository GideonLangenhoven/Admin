export function contactPhoneNumber(phone: string | null | undefined): string | null {
  const value = (phone || "").trim();
  if (!/^\+?[\d\s().-]+$/.test(value)) return null;
  const number = value.replace(/\D/g, "").replace(/^00/, "").replace(/^0/, "27");
  return /^[1-9]\d{6,14}$/.test(number) ? number : null;
}
