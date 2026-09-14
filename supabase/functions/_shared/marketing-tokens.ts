// One token map for every marketing email sender: the campaign dispatcher
// (marketing-dispatch), the automation dispatcher (marketing-automation-
// dispatch), and the admin "send test" path (send-email MARKETING_TEST).
// These maps drifted apart once already — the test path replaced only
// {first_name}, so an operator received an email with a literal
// {voucher_code} and {business_name} in it. Every sender must route
// through this function; a token added here reaches all three paths.
export type MarketingTokenValues = {
  first_name?: string;
  last_name?: string;
  email?: string;
  business_name?: string;
  site_url?: string;
  voucher_code?: string;
  voucher_amount?: string;
  promo_code?: string;
  promo_discount?: string;
};

export function fillMarketingTokens(input: string, v: MarketingTokenValues): string {
  return String(input || "")
    .replace(/\{first_name\}/g, v.first_name || "there")
    .replace(/\{last_name\}/g, v.last_name || "")
    .replace(/\{email\}/g, v.email || "")
    .replace(/\{voucher_code\}/g, v.voucher_code || "")
    .replace(/\{voucher_amount\}/g, v.voucher_amount || "")
    .replace(/\{promo_code\}/g, v.promo_code || "")
    .replace(/\{promo_discount\}/g, v.promo_discount || "")
    // Brand aliases, single or double braces ({business_name}, {{company_name}}, …)
    .replace(/\{\{?\s*(company_name|business_name|brand_name)\s*\}?\}/g, v.business_name || "")
    .replace(/\{site_url\}/g, v.site_url || "");
}
