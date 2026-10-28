"use client";

import { Check } from "@phosphor-icons/react";

// Multi-select buttons: each option switches on or off independently.
export default function OptionToggles({ label, options, picked, onChange }: {
  label: string;
  options: { id: string; label: string }[];
  picked: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = picked.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? picked.filter((id) => id !== option.id) : [...picked, option.id])}
            className={`ui-btn min-h-11 ${on ? "ui-btn-primary" : "ui-btn-ghost"}`}
          >
            {on && <Check size={16} weight="bold" aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
