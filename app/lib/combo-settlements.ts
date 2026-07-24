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

// Monday-based week bucket (UTC) for the weekly owed report.
export function weekStartISO(dateIso: string): string {
  const d = new Date(dateIso);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export type WeeklyOwedRow = { week_start: string; owed_to_me: number; owed_to_partner: number; count: number };

export function groupWeeklyOwed(
  items: Array<{ created_at: string; owed_to_me: number; owed_to_partner: number }>,
): WeeklyOwedRow[] {
  const byWeek: Record<string, WeeklyOwedRow> = {};
  for (const it of items) {
    const ws = weekStartISO(it.created_at);
    const row = (byWeek[ws] = byWeek[ws] || { week_start: ws, owed_to_me: 0, owed_to_partner: 0, count: 0 });
    row.owed_to_me += Number(it.owed_to_me || 0);
    row.owed_to_partner += Number(it.owed_to_partner || 0);
    row.count++;
  }
  return Object.values(byWeek).sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
}

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
