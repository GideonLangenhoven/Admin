import type { ReactNode } from "react";
import type { DashboardTileId } from "../app/lib/dashboard-layout";
import styles from "../app/dashboard.module.css";

// Fixed composition replaces the owner-retired dashboard layout editor.
export default function DashboardComposition({ tiles }: { tiles: Partial<Record<DashboardTileId, ReactNode>> }) {
  return <>
    {tiles.next_departure}
    <div className={styles.summaryBand}>
      {tiles.guests}
      {tiles.payment_recovery}
    </div>
    <section className={`${styles.operationsPanel} ui-card`} aria-label="Manifest and Roll Call">
      {tiles.manifest}
      {tiles.roll_call}
    </section>
    <div className={styles.attentionBand}>
      {tiles.refunds}
      {tiles.photos}
    </div>
    {tiles.weather}
  </>;
}
