export const DASHBOARD_TILES = [
  { id: "next_departure", label: "Next departure", size: "full" },
  { id: "guests", label: "Today's guests", size: "guests" },
  { id: "booking_value", label: "Booking value", size: "revenue" },
  { id: "manifest", label: "Manifest", size: "half" },
  { id: "roll_call", label: "Roll Call", size: "half" },
  { id: "refunds", label: "Pending refunds", size: "third" },
  { id: "inbox", label: "Inbox action", size: "third" },
  { id: "photos", label: "Photo upload backlog", size: "third" },
  { id: "payment_recovery", label: "Payment recovery", size: "full" },
  { id: "weather", label: "Weather", size: "full" },
] as const;

export type DashboardTileId = typeof DASHBOARD_TILES[number]["id"];
export type DashboardLayout = { order: DashboardTileId[]; hidden: DashboardTileId[] };
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = { order: DASHBOARD_TILES.map(tile => tile.id), hidden: [] };

function isTileId(value: unknown): value is DashboardTileId {
  return DASHBOARD_TILES.some(tile => tile.id === value);
}

export function validDashboardLayout(value: unknown): value is DashboardLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const layout = value as DashboardLayout;
  return Object.keys(layout).every(key => key === "order" || key === "hidden")
    && Array.isArray(layout.order) && layout.order.length === DASHBOARD_TILES.length
    && layout.order.every(isTileId) && new Set(layout.order).size === layout.order.length
    && Array.isArray(layout.hidden) && layout.hidden.length <= DASHBOARD_TILES.length
    && layout.hidden.every(isTileId) && new Set(layout.hidden).size === layout.hidden.length;
}

// New tiles join the end without moving or revealing an operator's saved tiles.
export function readDashboardLayout(order: unknown, hidden: unknown): DashboardLayout {
  const saved = Array.isArray(order) ? order.filter(isTileId) : [];
  return {
    order: [...new Set([...saved, ...DEFAULT_DASHBOARD_LAYOUT.order])],
    hidden: Array.isArray(hidden) ? [...new Set(hidden.filter(isTileId))] : [],
  };
}

export function moveDashboardTile(layout: DashboardLayout, id: DashboardTileId, target: DashboardTileId): DashboardLayout {
  const order = [...layout.order], from = order.indexOf(id), to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return layout;
  order.splice(from, 1);
  order.splice(to, 0, id);
  return { ...layout, order };
}
