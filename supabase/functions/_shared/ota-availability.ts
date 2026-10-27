import {
  categoryPrices,
  type Channel,
  fingerprint,
  type Inventory,
  localDateTime,
  minorUnits,
  vacancies,
} from "./ota-supplier.ts";
import { createSupplierBackend } from "./ota-backend.ts";
// Changes only, including explicit zero-capacity closures for removed departures.
// Provider notifications are at-least-once: failed persistence retries a notification,
// never reports a successful sync with a database/provider error.
// deno-lint-ignore no-explicit-any
export async function syncSupplierAvailability(
  db: any,
  businessId: string,
  channel: Channel,
  notify: (payload: unknown) => Promise<void>,
): Promise<{ changed: number }> {
  const boundary = await db.rpc("ota_assert_sandbox");
  if (boundary.error) {
    throw new Error(
      "OTA_NOT_READY: availability writes require a separate sandbox database",
    );
  }
  const integration = await db.from("ota_integrations").select("config_json")
    .eq("business_id", businessId).eq("channel", channel).maybeSingle();
  if (integration.error || !integration.data) {
    throw new Error("OTA integration lookup failed");
  }
  const supplierId = integration.data.config_json?.supplier_id;
  if (channel === "VIATOR" && !Number.isInteger(supplierId)) {
    throw new Error("Viator supplier ID is not configured");
  }
  const previous = await db.from("ota_availability_snapshots").select(
    "snapshot",
  ).eq("business_id", businessId).eq("channel", channel).maybeSingle();
  if (previous.error) throw new Error("OTA snapshot read failed");
  const inventory = await createSupplierBackend(db, businessId, channel)
    .catalog();
  const current: Record<string, unknown[]> = Object.create(null);
  let changed = 0;
  for (const product of inventory) {
    const id = channel === "VIATOR"
      ? product.supplierOptionId
      : product.product;
    if (!id) {
      throw new Error("Supplier product option identifier is not configured");
    }
    if (
      Object.hasOwn(current, id) ||
      (channel === "GETYOURGUIDE" && product.option)
    ) {
      throw new Error(
        "Ambiguous or unsupported supplier product/option mapping",
      );
    }
    const availabilities = product.slots.map((slot) =>
      availability(product, slot)
    );
    current[id] = availabilities;
  }
  const old = previous.data?.snapshot || {};
  for (const id of new Set([...Object.keys(old), ...Object.keys(current)])) {
    const nowRows = current[id] || [];
    const oldRows: Record<string, unknown>[] = old[id] || [];
    const updates: Record<string, unknown>[] = [];
    for (const row of nowRows as Record<string, unknown>[]) {
      const before = oldRows.find((r) => r.dateTime === row.dateTime);
      if (!before || await fingerprint(before) !== await fingerprint(row)) {
        updates.push(row);
      }
    }
    for (const row of oldRows) {
      if (
        !nowRows.some((r) =>
          (r as Record<string, unknown>).dateTime === row.dateTime
        ) && Date.parse(String(row.dateTime)) > Date.now()
      ) updates.push({ ...row, vacancies: 0 });
    }
    if (!updates.length) continue;
    if (channel === "GETYOURGUIDE") {
      await notify({ data: { productId: id, availabilities: updates } });
    } else {
      const dates = updates.map((r) => String(r.dateTime).slice(0, 10)).sort();
      await notify({
        supplierId,
        updateType: ["AVAILABILITY", "CAPACITY", "PRICING"],
        productOptionIds: [id],
        startDate: dates[0],
        endDate: dates[dates.length - 1],
      });
    }
    changed += updates.length;
  }
  const saved = await db.from("ota_availability_snapshots").upsert({
    business_id: businessId,
    channel,
    snapshot: current,
  }, { onConflict: "business_id,channel" });
  if (saved.error) {
    throw new Error("OTA snapshot write failed; retry notification safely");
  }
  const status = await db.from("ota_integrations").update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: "ok",
    last_sync_error: null,
  }).eq("business_id", businessId).eq("channel", channel);
  if (status.error) throw new Error("OTA sync status write failed");
  return { changed };
}
function availability(product: Inventory, slot: Inventory["slots"][number]) {
  return {
    dateTime: localDateTime(slot.start, product.timezone),
    vacancies: vacancies(slot),
    currency: product.currency,
    pricesByCategory: {
      retailPrices: categoryPrices(product, slot).map((p) => ({
        category: p.category,
        price: minorUnits(p.price, product.currency),
      })),
    },
  };
}
