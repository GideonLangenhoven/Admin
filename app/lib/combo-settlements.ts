// Pure aggregation for the combo settlement register: groups a batch of
// just-settled combo bookings per partnership into the row shape written to
// combo_settlements (collector = business A, who received the full payment
// and owes B the B-shares).
export type SettleableCombo = {
  id: string;
  combo_total: number | string;
  split_b_amount: number | string;
  created_at: string;
  combo_offers: { partnership_id: string; business_a_id: string; business_b_id: string };
};

export type SettlementRow = {
  partnership_id: string;
  period_start: string;
  period_end: string;
  collector_business_id: string;
  owed_business_id: string;
  total_collected: number;
  amount_owed: number;
  combo_booking_count: number;
};

export function groupSettlements(eligible: SettleableCombo[]): SettlementRow[] {
  const byPartnership: Record<string, SettleableCombo[]> = {};
  for (const c of eligible) {
    const key = c.combo_offers.partnership_id;
    (byPartnership[key] = byPartnership[key] || []).push(c);
  }
  return Object.entries(byPartnership).map(([partnershipId, group]) => {
    const dates = group.map((c) => String(c.created_at).slice(0, 10)).sort();
    return {
      partnership_id: partnershipId,
      period_start: dates[0],
      period_end: dates[dates.length - 1],
      collector_business_id: group[0].combo_offers.business_a_id,
      owed_business_id: group[0].combo_offers.business_b_id,
      total_collected: group.reduce((s, c) => s + Number(c.combo_total), 0),
      amount_owed: group.reduce((s, c) => s + Number(c.split_b_amount), 0),
      combo_booking_count: group.length,
    };
  });
}
