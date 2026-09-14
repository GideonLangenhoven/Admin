"use client";
import { useState, useRef } from "react";
import { supabase } from "../../app/lib/supabase";
import { notify } from "../../app/lib/app-notify";
import {
  Trash, DotsSixVertical, ArrowUp, ArrowDown,
} from "@phosphor-icons/react";
import type { Block } from "./blocks/block-types";
import { uid, createBlock } from "./blocks/block-types";
import { blocksToHtml } from "./blocks/blocks-to-html";
import { BlockEditor } from "./blocks/block-editors";

/* ── Toolbar block definitions ── */

const BLOCK_DEFS: { type: Block["type"]; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "button", label: "Button" },
  { type: "divider", label: "Divider" },
  { type: "spacer", label: "Spacer" },
  { type: "header", label: "Header" },
  { type: "social", label: "Social" },
  { type: "video", label: "Video" },
  { type: "quote", label: "Quote" },
  { type: "columns", label: "Columns" },
  { type: "countdown", label: "Countdown" },
  { type: "tourcard", label: "Tour Card" },
  { type: "footer", label: "Footer" },
];

/* ── Props ── */

interface EmailBuilderProps {
  businessId: string;
  initialName?: string;
  initialSubject?: string;
  initialCategory?: string;
  initialBlocks?: any[];
  onSave: (name: string, subject: string, category: string, blocks: Block[], html: string) => void;
}

export default function EmailBuilder({ businessId, initialName, initialSubject, initialCategory, initialBlocks, onSave }: EmailBuilderProps) {
  const [blocks, setBlocks] = useState<Block[]>(() => {
    if (initialBlocks && initialBlocks.length > 0) return initialBlocks as Block[];
    return [{ type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>Write your email content here...</p>" }];
  });
  const [name, setName] = useState(initialName || "");
  const [subject, setSubject] = useState(initialSubject || "");
  const [category, setCategory] = useState(initialCategory || "general");
  const [preview, setPreview] = useState(false);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadBlockId = useRef<string>("");

  function addBlock(type: Block["type"]) {
    setBlocks([...blocks, createBlock(type)]);
  }

  function updateBlock(id: string, updates: Partial<Block>) {
    setBlocks(blocks.map((b) => b.id === id ? { ...b, ...updates } as Block : b));
  }

  function removeBlock(id: string) {
    setBlocks(blocks.filter((b) => b.id !== id));
  }

  function moveBlock(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    const arr = [...blocks];
    [arr[index], arr[target]] = [arr[target], arr[index]];
    setBlocks(arr);
  }

  // Drag and drop — track by block ID to prevent index drift during rapid drags
  const dragBlockIdRef = useRef<string | null>(null);
  function handleDragStart(index: number) { setDragIndex(index); dragBlockIdRef.current = blocks[index]?.id || null; }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragBlockIdRef.current === null) return;
    const currentIdx = blocks.findIndex(b => b.id === dragBlockIdRef.current);
    if (currentIdx === -1 || currentIdx === index) return;
    const arr = [...blocks];
    const [moved] = arr.splice(currentIdx, 1);
    arr.splice(index, 0, moved);
    setBlocks(arr);
    setDragIndex(index);
  }
  function handleDragEnd() { setDragIndex(null); dragBlockIdRef.current = null; }

  // Image upload to Supabase storage
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blockId = uploadBlockId.current;
    setUploading(blockId);

    const ext = file.name.split(".").pop() || "png";
    const path = `${businessId}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage.from("marketing-assets").upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) {
      notify({ message: "Upload failed: " + error.message, tone: "error" });
      setUploading(null);
      return;
    }

    const { data: urlData } = supabase.storage.from("marketing-assets").getPublicUrl(path);

    // Determine which field to update based on block type
    const block = blocks.find((b) => b.id === blockId);
    if (block?.type === "tourcard") {
      updateBlock(blockId, { imageUrl: urlData.publicUrl } as any);
    } else if (block?.type === "quote") {
      updateBlock(blockId, { photoUrl: urlData.publicUrl } as any);
    } else {
      updateBlock(blockId, { src: urlData.publicUrl } as any);
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function triggerUpload(blockId: string) {
    uploadBlockId.current = blockId;
    fileRef.current?.click();
  }

  function handleSave() {
    if (!name.trim()) { notify({ message: "Template name is required.", tone: "warning" }); return; }
    const html = blocksToHtml(blocks);
    onSave(name.trim(), subject.trim(), category, blocks, html);
  }

  const previewHtml = blocksToHtml(blocks);

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

      {/* Template meta */}
      <div className="grid gap-3 sm:grid-cols-3">
        <input placeholder="Template name *" value={name} onChange={(e) => setName(e.target.value)}
          className="ui-control" />
        <input placeholder="Subject line" value={subject} onChange={(e) => setSubject(e.target.value)}
          className="ui-control" />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="ui-control">
          <option value="general">General</option>
          <option value="promotional">Promotional</option>
          <option value="newsletter">Newsletter</option>
          <option value="announcement">Announcement</option>
          <option value="follow-up">Follow-up</option>
        </select>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--ck-text-muted)" }}>Add block:</span>
        {BLOCK_DEFS.map((def) => (
          <button key={def.type} onClick={() => addBlock(def.type)}
            className="ui-btn ui-btn-ghost !h-8 !px-2.5 text-xs gap-1">
            {def.label}
          </button>
        ))}

        <div className="ml-auto flex gap-2">
          {preview && (
            <div className="ui-seg">
              <button onClick={() => setPreviewMode("desktop")} className="ui-seg-item" data-active={previewMode === "desktop"}>
                Desktop
              </button>
              <button onClick={() => setPreviewMode("mobile")} className="ui-seg-item" data-active={previewMode === "mobile"}>
                Mobile
              </button>
            </div>
          )}
          <button onClick={() => setPreview(!preview)} className="ui-btn ui-btn-ghost !h-8 !px-2.5 text-xs gap-1">
            {preview ? "Editor" : "Preview"}
          </button>
          <button onClick={handleSave} className="ui-btn ui-btn-primary !h-8 !px-3 text-xs gap-1">
            Save Template
          </button>
        </div>
      </div>

      {/* Variable hints */}
      <div className="text-xs flex flex-wrap gap-x-3 gap-y-1" style={{ color: "var(--ck-text-muted)" }}>
        <span>Variables:</span>
        {["{first_name}", "{last_name}", "{email}", "{promo_code}", "{promo_discount}", "{voucher_code}", "{voucher_amount}"].map((v) => (
          <code key={v} className="rounded bg-[var(--ck-surface-sunken)] px-1 py-0.5 text-[11px] text-[var(--ck-text)] cursor-pointer transition-colors hover:bg-[var(--ck-accent-soft)]" onClick={() => navigator.clipboard.writeText(v)}>{v}</code>
        ))}
        <span className="text-[10px] opacity-60">(click to copy)</span>
      </div>

      {preview ? (
        /* Preview */
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--ck-border-subtle)", background: "#f3f4f6" }}>
          <div className="p-2 text-xs font-medium" style={{ background: "var(--ck-surface)", color: "var(--ck-text-muted)", borderBottom: "1px solid var(--ck-border-subtle)" }}>
            Preview ({previewMode === "desktop" ? "Desktop 600px" : "Mobile 375px"}). Subject: {subject || "(none)"}
          </div>
          <div className="flex justify-center p-4" style={{ background: "#e5e7eb" }}>
            <iframe
              srcDoc={previewHtml}
              sandbox="allow-same-origin"
              className="border-0 bg-white"
              style={{
                width: previewMode === "desktop" ? 600 : 375,
                height: 600,
                borderRadius: previewMode === "mobile" ? 16 : 0,
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              }}
              title="Email Preview"
            />
          </div>
        </div>
      ) : (
        /* Block editor */
        <div className="space-y-2">
          {blocks.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--ck-border-subtle)" }}>
              <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>Add a block to start building your email.</p>
            </div>
          )}

          {blocks.map((block, index) => (
            <div
              key={block.id}
              onDragOver={(e) => handleDragOver(e, index)}
              className={`group rounded-xl border p-3 transition-colors bg-[var(--ck-surface)] hover:bg-[var(--ck-surface-sunken)] ${dragIndex === index ? "ring-2 ring-[var(--ck-accent)]" : ""}`}
              style={{ borderColor: "var(--ck-border-subtle)" }}
            >
              <div className="flex items-start gap-2">
                {/* Drag handle + controls */}
                <div className="flex flex-col items-center gap-1 pt-1 opacity-40 group-hover:opacity-100 transition-opacity">
                  <div
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragEnd={handleDragEnd}
                    className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-[var(--ck-surface-sunken)]"
                    title="Drag to reorder"
                    style={{ color: "var(--ck-text-muted)" }}
                  >
                    <DotsSixVertical size={14} />
                  </div>
                  <button onClick={() => moveBlock(index, -1)} disabled={index === 0} className="rounded p-0.5 transition-colors hover:bg-[var(--ck-surface-sunken)] disabled:opacity-40" style={{ color: "var(--ck-text-muted)" }}><ArrowUp size={12} /></button>
                  <button onClick={() => moveBlock(index, 1)} disabled={index === blocks.length - 1} className="rounded p-0.5 transition-colors hover:bg-[var(--ck-surface-sunken)] disabled:opacity-40" style={{ color: "var(--ck-text-muted)" }}><ArrowDown size={12} /></button>
                  <button onClick={() => removeBlock(block.id)} className="rounded p-0.5 mt-1 transition-colors hover:bg-[var(--ck-danger-soft)]" style={{ color: "var(--ck-danger)" }}><Trash size={12} /></button>
                </div>

                {/* Block content */}
                <div className="flex-1 min-w-0">
                  <BlockEditor
                    block={block}
                    onUpdate={(updates) => updateBlock(block.id, updates)}
                    onUpload={triggerUpload}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
