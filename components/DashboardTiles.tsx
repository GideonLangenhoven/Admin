"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, DotsSixVertical, EyeSlash, SlidersHorizontal } from "@phosphor-icons/react";
import { useBusinessContext } from "./BusinessContext";
import { getAuthHeaders } from "../app/lib/admin-auth";
import { isPrivilegedRole } from "../app/lib/role-utils";
import { DASHBOARD_TILES, DEFAULT_DASHBOARD_LAYOUT, moveDashboardTile, validDashboardLayout, type DashboardLayout, type DashboardTileId } from "../app/lib/dashboard-layout";
import styles from "./DashboardTiles.module.css";

type SavedLayout = { layout: DashboardLayout; revision: number };

export default function DashboardTiles({ tiles }: { tiles: Partial<Record<DashboardTileId, ReactNode>> }) {
  const { businessId, role, readOnly } = useBusinessContext();
  const canEdit = isPrivilegedRole(role) && !readOnly;
  const [saved, setSaved] = useState<SavedLayout | null>(null);
  const [draft, setDraft] = useState<DashboardLayout>(DEFAULT_DASHBOARD_LAYOUT);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [reload, setReload] = useState(0);
  const [drag, setDrag] = useState<{ id: DashboardTileId; target: DashboardTileId | null } | null>(null);
  const saveBusy = useRef(false);
  const requestVersion = useRef(0);
  const editorOpen = useRef(false);
  editorOpen.current = editing && canEdit;
  const handleRefs = useRef<Partial<Record<DashboardTileId, HTMLButtonElement | null>>>({});
  const pointer = useRef<{ x: number; y: number; scroller: HTMLElement | null } | null>(null);
  const draggingId = drag?.id;

  useEffect(() => {
    if (!draggingId) return;
    let frame: number;
    function tick() {
      const position = pointer.current;
      if (position) {
        const { x, y, scroller } = position, bounds = scroller?.getBoundingClientRect();
        if (scroller && bounds) {
          if (y < bounds.top + 64) scroller.scrollBy(0, -8);
          else if (y > bounds.bottom - 64) scroller.scrollBy(0, 8);
        }
        const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-layout-id]");
        const target = (row?.dataset.layoutId as DashboardTileId | undefined) || null;
        setDrag(current => current && current.target !== target ? { ...current, target } : current);
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draggingId]);

  useEffect(() => {
    if (!canEdit) { setEditing(false); setDrag(null); }
  }, [canEdit]);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    async function load() {
      const version = ++requestVersion.current;
      try {
        const response = await fetch("/api/dashboard-layout", { headers: await getAuthHeaders(businessId), signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load the saved layout. Try again.");
        if (!validDashboardLayout(data.layout) || !Number.isInteger(data.revision) || data.revision < 0) throw new Error("Could not read the saved layout. Try again.");
        if (!disposed && version === requestVersion.current && !editorOpen.current) { setSaved(data); setDraft(data.layout); setError(""); setConflict(false); }
      } catch (e) {
        if (!disposed && version === requestVersion.current && !editorOpen.current) setError(e instanceof Error ? e.message : "Could not load the saved layout. Try again.");
      }
    }
    void load();
    const onFocus = () => { if (!editorOpen.current) void load(); };
    window.addEventListener("focus", onFocus);
    return () => { disposed = true; controller.abort(); window.removeEventListener("focus", onFocus); };
  }, [businessId, reload]);

  const layout = editing && canEdit ? draft : saved?.layout;
  const visible = (layout?.order || []).filter(id => tiles[id] && !layout?.hidden.includes(id));
  const hidden = (layout?.order || []).filter(id => tiles[id] && layout?.hidden.includes(id));
  const tileName = (id: DashboardTileId) => DASHBOARD_TILES.find(tile => tile.id === id)!.label;

  function move(id: DashboardTileId, target: DashboardTileId) {
    const next = moveDashboardTile(draft, id, target);
    setDraft(next);
    const position = next.order.filter(tile => tiles[tile] && !next.hidden.includes(tile)).indexOf(id) + 1;
    setAnnouncement(`${tileName(id)} moved to position ${position} of ${visible.length}.`);
  }

  function hide(id: DashboardTileId) {
    setDraft(current => ({ ...current, hidden: [...current.hidden, id] }));
    setAnnouncement(`${tileName(id)} hidden. Restore it from Hidden tiles.`);
    const next = visible[visible.indexOf(id) + 1] || visible[visible.indexOf(id) - 1];
    requestAnimationFrame(() => {
      if (next) handleRefs.current[next]?.focus();
      else document.getElementById("dashboard-hidden-tiles")?.focus();
    });
  }

  async function save() {
    if (!saved || saveBusy.current || !canEdit) return;
    saveBusy.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/dashboard-layout", { method: "POST", headers: await getAuthHeaders(businessId), body: JSON.stringify({ layout: draft, revision: saved.revision }) });
      const data = await response.json();
      if (!response.ok) { setConflict(response.status === 409); throw new Error(data.error || "Could not save the layout. Try again."); }
      if (!validDashboardLayout(data.layout) || !Number.isInteger(data.revision) || data.revision < 1) throw new Error("Could not confirm the saved layout. Reload it before editing again.");
      setSaved(data); setDraft(data.layout); setEditing(false); setConflict(false); setAnnouncement("Dashboard layout saved for this operator.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the layout. Try again."); }
    finally { saveBusy.current = false; setSaving(false); }
  }

  function reloadSaved() {
    setEditing(false); setSaved(null); setError(""); setConflict(false); setReload(value => value + 1);
  }

  return <div className={styles.workspace}>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {error && <div className="ui-card p-4" role="alert">
      <p>{error}</p>
      {(!saved || conflict || !editing) && <button type="button" className="ui-btn ui-btn-soft mt-3" onClick={reloadSaved}>{conflict ? "Discard & reload" : "Try again"}</button>}
    </div>}
    {!saved && !error && <div role="status" aria-label="Loading dashboard layout" className="space-y-4"><div className="ui-skeleton h-24" /><div className="ui-skeleton h-48" /></div>}
    {saved && <>
      {canEdit && !editing && <div className={styles.toolbar}>
        <button
          type="button"
          className="ui-btn ui-btn-ghost !h-9 !w-9 !p-0"
          aria-label="Edit dashboard"
          title="Edit dashboard"
          onClick={() => { requestVersion.current++; setDraft(saved.layout); setEditing(true); setError(""); setAnnouncement(""); }}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
        </button>
      </div>}
      {editing && canEdit ? <section className="ui-card p-4 sm:p-5" aria-labelledby="dashboard-layout-title">
        <div className={styles.editorHeader}>
          <div><h3 id="dashboard-layout-title" className="text-lg font-semibold">Arrange dashboard</h3><p className={styles.hint}>Drag or use arrows. Save applies this layout for everyone.</p></div>
          <div className={styles.actions}>
            <button type="button" className="ui-btn ui-btn-ghost" disabled={saving} onClick={() => { setEditing(false); setDraft(saved.layout); setError(""); setConflict(false); setDrag(null); }}>Cancel</button>
            <button type="button" className="ui-btn ui-btn-primary" disabled={saving || conflict || !!drag} onClick={save}>{saving ? "Saving…" : "Save layout"}</button>
          </div>
        </div>
        <div className="mb-4">
          <button type="button" className="ui-btn ui-btn-soft min-h-11" disabled={saving || conflict || !!drag} onClick={() => { setDraft({ order: [...DEFAULT_DASHBOARD_LAYOUT.order], hidden: [] }); setError(""); setAnnouncement("Default restored. Save layout to apply for everyone."); }}>Restore default layout</button>
          <p className={styles.hint}>Restore all tiles and their original order. Save layout to apply.</p>
        </div>
        <ol className={styles.list} aria-label="Visible dashboard tiles">
          {visible.map((id, index) => <li key={id} data-layout-id={id} className={styles.row} data-dragging={drag?.id === id || undefined} data-target={drag?.target === id && drag.id !== id || undefined}>
            <button type="button" className={`ui-btn ui-btn-ghost ${styles.handle}`} ref={node => { handleRefs.current[id] = node; }} aria-label={`Move ${tileName(id)}`} title="Drag to move. Use arrow keys to move one place." disabled={saving}
              onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); const target = visible[index + (event.key === "ArrowUp" ? -1 : 1)]; if (target) move(id, target); } }}
              onPointerDown={event => { if (event.button !== 0 || saving) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { x: event.clientX, y: event.clientY, scroller: event.currentTarget.closest("main") }; setDrag({ id, target: id }); }}
              onPointerMove={event => { if (pointer.current) { pointer.current.x = event.clientX; pointer.current.y = event.clientY; } }}
              onPointerUp={event => { const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-layout-id]")?.dataset.layoutId as DashboardTileId | undefined; if (drag && target && visible.includes(target)) move(drag.id, target); setDrag(null); pointer.current = null; }}
              onPointerCancel={() => { setDrag(null); pointer.current = null; }}
              onLostPointerCapture={() => { setDrag(null); pointer.current = null; }}>
              <DotsSixVertical size={22} aria-hidden="true" />
            </button>
            <span className={styles.label}>{tileName(id)}</span>
            <div className={styles.actions}>
              <button type="button" className="ui-btn ui-btn-ghost !p-2" aria-label={`Move ${tileName(id)} up`} title="Move up" disabled={saving || index === 0} onClick={() => move(id, visible[index - 1])}><ArrowUp size={18} aria-hidden="true" /></button>
              <button type="button" className="ui-btn ui-btn-ghost !p-2" aria-label={`Move ${tileName(id)} down`} title="Move down" disabled={saving || index === visible.length - 1} onClick={() => move(id, visible[index + 1])}><ArrowDown size={18} aria-hidden="true" /></button>
              <button type="button" className="ui-btn ui-btn-ghost !px-3" aria-label={`Hide ${tileName(id)}`} disabled={saving} onClick={() => hide(id)}><EyeSlash size={18} aria-hidden="true" /><span className={styles.hideText}>Hide</span></button>
            </div>
          </li>)}
        </ol>
        {visible.length === 0 && <p className="py-4">All tiles are hidden. Show a tile below to add it back.</p>}
        <div className={styles.hidden}>
          <h4 id="dashboard-hidden-tiles" tabIndex={-1} className="font-semibold">Hidden tiles ({hidden.length})</h4>
          {hidden.length === 0 ? <p className={styles.hint}>Show hidden tiles here.</p> : <ul className={styles.hiddenList}>
            {hidden.map(id => <li key={id}><span>{tileName(id)}</span><button type="button" className="ui-btn ui-btn-soft" aria-label={`Show ${tileName(id)}`} disabled={saving} onClick={() => { setDraft(current => ({ ...current, hidden: current.hidden.filter(tile => tile !== id) })); setAnnouncement(`${tileName(id)} restored to the dashboard.`); }}>Show</button></li>)}
          </ul>}
        </div>
      </section> : <>
        {visible.length === 0 && <div className="ui-card p-6"><h3 className="text-lg font-semibold">No dashboard tiles are showing</h3><p className="mt-2">{canEdit ? "Choose Edit dashboard to show tiles again." : "A main or super admin can show tiles again."}</p></div>}
        <div className={styles.grid}>
          {visible.map(id => <div key={id} data-dashboard-tile={id} data-size={DASHBOARD_TILES.find(tile => tile.id === id)!.size} className={styles.tile}>{tiles[id]}</div>)}
        </div>
      </>}
    </>}
  </div>;
}
