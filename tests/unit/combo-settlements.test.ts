import { describe, expect, it } from "vitest";
import { groupSettlements, type SettleableCombo } from "../../app/lib/combo-settlements";

function combo(partial: Partial<SettleableCombo> & { id: string }): SettleableCombo {
  return {
    combo_total: 1000,
    split_b_amount: 400,
    created_at: "2026-07-10T08:00:00Z",
    combo_offers: { partnership_id: "p1", business_a_id: "A", business_b_id: "B" },
    ...partial,
  };
}

describe("groupSettlements", () => {
  it("aggregates totals, owed amount and period per partnership", () => {
    const rows = groupSettlements([
      combo({ id: "c1", combo_total: 1000, split_b_amount: 400, created_at: "2026-07-10T08:00:00Z" }),
      combo({ id: "c2", combo_total: "500.50", split_b_amount: "200.25", created_at: "2026-07-05T12:00:00Z" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      partnership_id: "p1",
      collector_business_id: "A",
      owed_business_id: "B",
      total_collected: 1500.5,
      amount_owed: 600.25,
      combo_booking_count: 2,
      period_start: "2026-07-05",
      period_end: "2026-07-10",
    });
  });

  it("splits batches spanning multiple partnerships into separate rows", () => {
    const rows = groupSettlements([
      combo({ id: "c1" }),
      combo({ id: "c2", combo_offers: { partnership_id: "p2", business_a_id: "A", business_b_id: "C" } }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.partnership_id).sort()).toEqual(["p1", "p2"]);
    expect(rows.find(r => r.partnership_id === "p2")?.owed_business_id).toBe("C");
  });

  it("returns no rows for an empty batch", () => {
    expect(groupSettlements([])).toEqual([]);
  });
});
