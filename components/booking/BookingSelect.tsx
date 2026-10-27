"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check } from "@phosphor-icons/react";
import styles from "./BookingSelect.module.css";

export default function BookingSelect({ id, label, value, options, onChange, placeholder = "Choose an option", error, disabled, required }: {
  id?: string;
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: boolean;
  disabled?: boolean;
  required?: boolean;
}) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number }>();
  const expanded = open && !disabled;
  const menuHeight = position?.maxHeight;

  useLayoutEffect(() => {
    if (!expanded) return;
    function place() {
      if (!trigger.current || !menu.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop || 0;
      const left = viewport?.offsetLeft || 0;
      const height = viewport?.height || window.innerHeight;
      const width = viewport?.width || window.innerWidth;
      if (rect.bottom < top || rect.top > top + height) { setOpen(false); return; }
      const menuWidth = Math.min(Math.max(rect.width, 288), width - 16);
      menu.current.style.width = `${menuWidth}px`;
      const desiredHeight = Math.min(menu.current.scrollHeight + 2, 320);
      const below = Math.max(0, top + height - rect.bottom - 14);
      const above = Math.max(0, rect.top - top - 14);
      const down = below >= desiredHeight || below >= above;
      const maxHeight = Math.min(320, down ? below : above);
      setPosition({
        top: down ? rect.bottom + 6 : Math.max(top + 8, rect.top - Math.min(desiredHeight, maxHeight) - 6),
        left: Math.max(left + 8, Math.min(rect.left, left + width - menuWidth - 8)),
        width: menuWidth, maxHeight,
      });
    }
    function outside(event: PointerEvent) {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      document.removeEventListener("pointerdown", outside);
    };
  }, [expanded, options]);

  useLayoutEffect(() => {
    if (expanded && menuHeight !== undefined) menu.current?.querySelectorAll('[role="option"]')[active]?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, menuHeight]);

  function show(index = Math.max(0, options.findIndex(option => option.id === value))) {
    setActive(index);
    setPosition(undefined);
    setOpen(true);
  }

  function choose(index: number) {
    if (!options[index]) return;
    setOpen(false);
    onChange(options[index].id);
    trigger.current?.focus({ preventScroll: true });
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" || event.key === "Tab") { setOpen(false); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (!expanded) { show(event.key === "End" ? Math.max(0, options.length - 1) : undefined); return; }
      if (event.key === "Enter" || event.key === " ") choose(active);
      else setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const text = Date.now() - search.current.time < 700 ? search.current.text + event.key : event.key;
      search.current = { text, time: Date.now() };
      const index = options.findIndex(option => option.name.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()));
      if (index >= 0) { if (expanded) setActive(index); else show(index); }
    }
  }

  return <>
    <button ref={trigger} id={id} type="button" role="combobox" aria-label={label} aria-haspopup="listbox"
      aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded && options[active] ? `${listId}-${active}` : undefined}
      aria-invalid={error || undefined} aria-required={required || undefined} disabled={disabled} data-value={value}
      onClick={() => expanded ? setOpen(false) : show()} onKeyDown={keyDown} onBlur={() => setOpen(false)}
      className={`ui-control ${styles.control}`}>
      <span>{options.find(option => option.id === value)?.name || placeholder}</span>
      <CaretDown size={18} aria-hidden="true" />
    </button>
    {expanded && createPortal(<div ref={menu} id={listId} role="listbox" aria-label={label}
      className={styles.menu} style={position || { visibility: "hidden" }}>
      {options.length ? options.map((option, index) => <div key={option.id} id={`${listId}-${index}`} role="option"
        aria-selected={option.id === value} data-active={index === active} className={styles.option}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span>{option.name}</span>{option.id === value && <Check size={18} aria-hidden="true" />}
      </div>) : <p className={styles.empty}>No options available</p>}
    </div>, document.body)}
  </>;
}
