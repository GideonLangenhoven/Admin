// Browser progress for foreground, per-item refunds. The server's
// refund_operations table remains authoritative for money outcomes.
export type RefundJournalStatus = "unprocessed" | "submitting" | "completed" | "pending" | "manual_action" | "failed" | "unknown";
export type RefundJournal = {
  actorId: string;
  businessId: string;
  surface: "bookings" | "refunds";
  items: Array<{ id: string; status: RefundJournalStatus }>;
};

function key(surface: RefundJournal["surface"], businessId: string, actorId: string) {
  return `refund-bulk-v1:${surface}:${businessId}:${actorId}`;
}

export function readRefundJournal(surface: RefundJournal["surface"], businessId: string, actorId: string): RefundJournal | null {
  const raw = localStorage.getItem(key(surface, businessId, actorId));
  if (!raw) return null;
  const journal = JSON.parse(raw) as RefundJournal;
  if (journal.surface !== surface || journal.businessId !== businessId || journal.actorId !== actorId ||
      !Array.isArray(journal.items) || journal.items.length < 1 || journal.items.length > 100 ||
      journal.items.some(item => typeof item.id !== "string" || !item.id ||
        !["unprocessed", "submitting", "completed", "pending", "manual_action", "failed", "unknown"].includes(item.status))) {
    throw new Error("Saved refund progress could not be read. Please reconcile the prior batch before submitting another.");
  }
  return journal;
}

export function saveRefundJournal(journal: RefundJournal) {
  const storageKey = key(journal.surface, journal.businessId, journal.actorId);
  localStorage.setItem(storageKey, JSON.stringify(journal));
  if (localStorage.getItem(storageKey) !== JSON.stringify(journal)) throw new Error("Refund progress could not be saved");
}

export function unresolvedRefundJournal(journal: RefundJournal) {
  return journal.items.some(item => ["unprocessed", "submitting", "unknown"].includes(item.status));
}

export function uncertainRefundJournal(journal: RefundJournal): RefundJournal {
  return { ...journal, items: journal.items.map(item => ({
    ...item, status: item.status === "unprocessed" ? "unprocessed" as const : "unknown" as const,
  })) };
}

export async function reconcileRefundJournal(
  journal: RefundJournal,
  lookup: (ids: string[], businessId: string) => Promise<{ data: Array<{ id: string; refund_status: string | null; refund_request_id: string | null }> | null; error: unknown }>,
): Promise<RefundJournal> {
  const submitted = journal.items.filter(item => item.status !== "unprocessed").map(item => item.id);
  if (submitted.length === 0) return journal;
  const { data, error } = await lookup(submitted, journal.businessId);
  if (error || !Array.isArray(data)) throw new Error("Could not read authoritative refund status");
  const rows = new Map(data.map(row => [row.id, row]));
  return { ...journal, items: journal.items.map(item => {
    if (item.status === "unprocessed") return item;
    const row = rows.get(item.id);
    const status: RefundJournalStatus = row?.refund_status === "REFUNDED" || row?.refund_status === "PROCESSED" ? "completed"
      : row?.refund_status === "MANUAL_EFT_REQUIRED" ? "manual_action"
        : row?.refund_status === "REFUND_PENDING" && row.refund_request_id ? "pending"
          : "unknown";
    return { id: item.id, status };
  }) };
}
