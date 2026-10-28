import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { genVoucherCode } from "../../supabase/functions/_shared/vouchers.ts";

// Voucher codes are spendable credit: unpredictable, and every symbol in play.
describe("voucher codes", () => {
  it("come from the CSPRNG and use all 32 symbols", () => {
    const random = vi.spyOn(Math, "random");
    const seen = new Set(Array.from({ length: 400 }, genVoucherCode).join(""));
    expect(random).not.toHaveBeenCalled();
    expect([...seen].sort().join("")).toBe("23456789ABCDEFGHJKLMNPQRSTUVWXYZ");
    expect(genVoucherCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    random.mockRestore();
  });

  it("both bots mint codes with it", () => {
    for (const file of ["supabase/functions/web-chat/index.ts", "supabase/functions/wa-webhook/index.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(/import \{[^}]*\bgenVoucherCode\b[^}]*\} from "\.\.\/_shared\/vouchers\.ts"/);
      expect(src).not.toMatch(/function genVoucherCode|Math\.random\(\) \* 31/);
    }
  });
});
