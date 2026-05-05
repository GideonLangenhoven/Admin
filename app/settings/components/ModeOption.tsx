"use client";

type Props = {
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  title: string;
  description: string;
  disabled?: boolean;
};

export default function ModeOption({ value, checked, onChange, title, description, disabled }: Props) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors ${
        checked ? "border-emerald-300 bg-emerald-50/50" : "border-[var(--ck-border)] hover:bg-[var(--ck-surface)]"
      } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <input
        type="radio"
        name="whatsapp_bot_mode"
        value={value}
        checked={checked}
        onChange={() => !disabled && onChange(value)}
        disabled={disabled}
        className="mt-0.5 accent-emerald-600"
      />
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{title}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--ck-text-muted)" }}>{description}</p>
      </div>
    </label>
  );
}
