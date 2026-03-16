"use client";

import { useRef, useEffect } from "react";

interface Props {
  value: string;
  onChange: (html: string) => void;
  rows?: number;
  placeholder?: string;
}

const TOOLBAR: { cmd: string; arg?: string; label: string; title: string }[] = [
  { cmd: "bold", label: "B", title: "Bold" },
  { cmd: "italic", label: "I", title: "Italic" },
  { cmd: "underline", label: "U", title: "Underline" },
  { cmd: "insertUnorderedList", label: "• List", title: "Bullet list" },
  { cmd: "insertOrderedList", label: "1. List", title: "Numbered list" },
];

const HEADINGS = [
  { value: "", label: "Normal" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
];

const FONT_SIZES = [
  { value: "1", label: "Small" },
  { value: "3", label: "Normal" },
  { value: "5", label: "Large" },
  { value: "7", label: "Extra Large" },
];

export default function RichTextEditor({ value, onChange, rows = 10, placeholder }: Props) {
  var editorRef = useRef<HTMLDivElement>(null);
  var internalUpdate = useRef(false);

  // Sync external value changes into the editor
  useEffect(() => {
    if (editorRef.current && !internalUpdate.current) {
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value;
      }
    }
    internalUpdate.current = false;
  }, [value]);

  function handleInput() {
    if (editorRef.current) {
      internalUpdate.current = true;
      onChange(editorRef.current.innerHTML);
    }
  }

  function exec(cmd: string, arg?: string) {
    document.execCommand(cmd, false, arg);
    editorRef.current?.focus();
    handleInput();
  }

  function handleHeading(tag: string) {
    if (tag) {
      exec("formatBlock", `<${tag}>`);
    } else {
      exec("formatBlock", "<p>");
    }
  }

  function handleFontSize(size: string) {
    exec("fontSize", size);
  }

  var minH = rows * 24;

  return (
    <div className="rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--ck-border-subtle)] bg-[var(--ck-bg)] px-2 py-1.5">
        <select
          onChange={e => handleHeading(e.target.value)}
          defaultValue=""
          className="h-7 rounded border border-[var(--ck-border-subtle)] bg-white px-1.5 text-xs text-[var(--ck-text)] outline-none"
          title="Text style"
        >
          {HEADINGS.map(h => (
            <option key={h.value} value={h.value}>{h.label}</option>
          ))}
        </select>

        <select
          onChange={e => handleFontSize(e.target.value)}
          defaultValue="3"
          className="h-7 rounded border border-[var(--ck-border-subtle)] bg-white px-1.5 text-xs text-[var(--ck-text)] outline-none"
          title="Font size"
        >
          {FONT_SIZES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <div className="mx-1 h-5 w-px bg-[var(--ck-border-subtle)]" />

        {TOOLBAR.map(t => (
          <button
            key={t.cmd}
            type="button"
            onClick={() => exec(t.cmd, t.arg)}
            title={t.title}
            className="flex h-7 items-center rounded px-2 text-xs font-semibold text-[var(--ck-text-muted)] hover:bg-[var(--ck-bg-subtle)] hover:text-[var(--ck-text-strong)]"
            style={t.cmd === "italic" ? { fontStyle: "italic" } : t.cmd === "underline" ? { textDecoration: "underline" } : t.cmd === "bold" ? { fontWeight: 700 } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Editor area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className="rich-editor-content px-3 py-2 text-sm text-[var(--ck-text)] outline-none overflow-y-auto"
        style={{ minHeight: minH }}
      />
    </div>
  );
}
