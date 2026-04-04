"use client";
import { useState, useRef } from "react";
import { supabase } from "../../app/lib/supabase";
import { notify } from "../../app/lib/app-notify";
import {
  Trash2, GripVertical, Type, Image as ImageIcon, Minus, ArrowUp, ArrowDown,
  Eye, Code, Save, MousePointerClick, MoveVertical, Heading, Share2, Play,
  Quote, Columns2, Timer, MapPin, FileText, Monitor, Smartphone,
} from "lucide-react";
import type { Block } from "./blocks/block-types";
import { uid, createBlock } from "./blocks/block-types";
import { blocksToHtml } from "./blocks/blocks-to-html";
import { BlockEditor } from "./blocks/block-editors";

/* ── Toolbar block definitions ── */

var BLOCK_DEFS: { type: Block["type"]; label: string; icon: React.ReactNode }[] = [
  { type: "text", label: "Text", icon: <Type size={12} /> },
  { type: "image", label: "Image", icon: <ImageIcon size={12} /> },
  { type: "button", label: "Button", icon: <MousePointerClick size={12} /> },
  { type: "divider", label: "Divider", icon: <Minus size={12} /> },
  { type: "spacer", label: "Spacer", icon: <MoveVertical size={12} /> },
  { type: "header", label: "Header", icon: <Heading size={12} /> },
  { type: "social", label: "Social", icon: <Share2 size={12} /> },
  { type: "video", label: "Video", icon: <Play size={12} /> },
  { type: "quote", label: "Quote", icon: <Quote size={12} /> },
  { type: "columns", label: "Columns", icon: <Columns2 size={12} /> },
  { type: "countdown", label: "Countdown", icon: <Timer size={12} /> },
  { type: "tourcard", label: "Tour Card", icon: <MapPin size={12} /> },
  { type: "footer", label: "Footer", icon: <FileText size={12} /> },
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
  var [blocks, setBlocks] = useState<Block[]>(() => {
    if (initialBlocks && initialBlocks.length > 0) return initialBlocks as Block[];
    return [{ type: "text", id: uid(), content: "<p>Hi {first_name},</p><p>Write your email content here...</p>" }];
  });
  var [name, setName] = useState(initialName || "");
  var [subject, setSubject] = useState(initialSubject || "");
  var [category, setCategory] = useState(initialCategory || "general");
  var [preview, setPreview] = useState(false);
  var [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  var [dragIndex, setDragIndex] = useState<number | null>(null);
  var [uploading, setUploading] = useState<string | null>(null);
  var fileRef = useRef<HTMLInputElement>(null);
  var uploadBlockId = useRef<string>("");

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
    var target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    var arr = [...blocks];
    [arr[index], arr[target]] = [arr[target], arr[index]];
    setBlocks(arr);
  }

  // Drag and drop — track by block ID to prevent index drift during rapid drags
  var dragBlockIdRef = useRef<string | null>(null);
  function handleDragStart(index: number) { setDragIndex(index); dragBlockIdRef.current = blocks[index]?.id || null; }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragBlockIdRef.current === null) return;
    var currentIdx = blocks.findIndex(b => b.id === dragBlockIdRef.current);
    if (currentIdx === -1 || currentIdx === index) return;
    var arr = [...blocks];
    var [moved] = arr.splice(currentIdx, 1);
    arr.splice(index, 0, moved);
    setBlocks(arr);
    setDragIndex(index);
  }
  function handleDragEnd() { setDragIndex(null); dragBlockIdRef.current = null; }

  // Image upload to Supabase storage
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    var file = e.target.files?.[0];
    if (!file) return;
    var blockId = uploadBlockId.current;
    setUploading(blockId);

    var ext = file.name.split(".").pop() || "png";
    var path = `${businessId}/${Date.now()}.${ext}`;

    var { error } = await supabase.storage.from("marketing-assets").upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) {
      notify({ message: "Upload failed: " + error.message, tone: "error" });
      setUploading(null);
      return;
    }

    var { data: urlData } = supabase.storage.from("marketing-assets").getPublicUrl(path);

    // Determine which field to update based on block type
    var block = blocks.find((b) => b.id === blockId);
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
    var html = blocksToHtml(blocks);
    onSave(name.trim(), subject.trim(), category, blocks, html);
  }

  var previewHtml = blocksToHtml(blocks);

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

      {/* Template meta */}
      <div className="grid gap-3 sm:grid-cols-3">
        <input placeholder="Template name *" value={name} onChange={(e) => setName(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }} />
        <input placeholder="Subject line" value={subject} onChange={(e) => setSubject(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }}>
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
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
            {def.icon} {def.label}
          </button>
        ))}

        <div className="ml-auto flex gap-2">
          {preview && (
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--ck-border)" }}>
              <button
                onClick={() => setPreviewMode("desktop")}
                className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium"
                style={{
                  background: previewMode === "desktop" ? "var(--ck-accent)" : "transparent",
                  color: previewMode === "desktop" ? "#fff" : "var(--ck-text)",
                }}
              >
                <Monitor size={12} /> Desktop
              </button>
              <button
                onClick={() => setPreviewMode("mobile")}
                className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium"
                style={{
                  background: previewMode === "mobile" ? "var(--ck-accent)" : "transparent",
                  color: previewMode === "mobile" ? "#fff" : "var(--ck-text)",
                }}
              >
                <Smartphone size={12} /> Mobile
              </button>
            </div>
          )}
          <button onClick={() => setPreview(!preview)} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
            {preview ? <><Code size={12} /> Editor</> : <><Eye size={12} /> Preview</>}
          </button>
          <button onClick={handleSave} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "var(--ck-accent)" }}>
            <Save size={12} /> Save Template
          </button>
        </div>
      </div>

      {/* Variable hints */}
      <div className="text-xs flex flex-wrap gap-x-3 gap-y-1" style={{ color: "var(--ck-text-muted)" }}>
        <span>Variables:</span>
        {["{first_name}", "{last_name}", "{email}", "{promo_code}", "{promo_discount}", "{voucher_code}", "{voucher_amount}"].map((v) => (
          <code key={v} className="rounded bg-gray-100 px-1 py-0.5 text-[11px] cursor-pointer hover:bg-gray-200" onClick={() => navigator.clipboard.writeText(v)}>{v}</code>
        ))}
        <span className="text-[10px] opacity-60">(click to copy)</span>
      </div>

      {preview ? (
        /* Preview */
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--ck-border)", background: "#f3f4f6" }}>
          <div className="p-2 text-xs font-medium" style={{ background: "var(--ck-surface)", color: "var(--ck-text-muted)", borderBottom: "1px solid var(--ck-border)" }}>
            Preview ({previewMode === "desktop" ? "Desktop 600px" : "Mobile 375px"}) — Subject: {subject || "(none)"}
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
            <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--ck-border)" }}>
              <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>Add a block to start building your email.</p>
            </div>
          )}

          {blocks.map((block, index) => (
            <div
              key={block.id}
              onDragOver={(e) => handleDragOver(e, index)}
              className={`group rounded-xl border p-3 transition-colors ${dragIndex === index ? "ring-2 ring-blue-400" : ""}`}
              style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}
            >
              <div className="flex items-start gap-2">
                {/* Drag handle + controls */}
                <div className="flex flex-col items-center gap-1 pt-1 opacity-40 group-hover:opacity-100 transition-opacity">
                  <div
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragEnd={handleDragEnd}
                    className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-[var(--ck-bg-subtle)]"
                    title="Drag to reorder"
                  >
                    <GripVertical size={14} />
                  </div>
                  <button onClick={() => moveBlock(index, -1)} disabled={index === 0}><ArrowUp size={12} /></button>
                  <button onClick={() => moveBlock(index, 1)} disabled={index === blocks.length - 1}><ArrowDown size={12} /></button>
                  <button onClick={() => removeBlock(block.id)} className="text-red-500 mt-1"><Trash2 size={12} /></button>
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
