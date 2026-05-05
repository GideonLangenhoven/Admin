"use client";
import { useState, useRef } from "react";
import { Image as ImageIcon, Plus, Trash, X, TextB, TextItalic, TextUnderline, TextAlignLeft, TextAlignCenter, TextAlignRight } from "@phosphor-icons/react";
import type {
  Block,
  TextBlock,
  ImageBlock,
  ButtonBlock,
  SpacerBlock,
  HeaderBlock,
  SocialBlock,
  VideoBlock,
  QuoteBlock,
  ColumnsBlock,
  CountdownBlock,
  TourCardBlock,
  FooterBlock,
} from "./block-types";
import { createBlock } from "./block-types";
import { SOCIAL_PLATFORMS } from "./social-icons";

/* ── Shared styling helpers ── */

const inputCls = "rounded-lg border px-2 py-1.5 text-xs";
const inputStyle = { borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" };
const labelCls = "text-[10px] font-semibold uppercase tracking-wider";
const labelStyle = { color: "var(--ck-text-muted)" };

function Label({ children }: { children: string }) {
  return <span className={labelCls} style={labelStyle}>{children}</span>;
}

/* ── Main export ── */

export function BlockEditor({
  block,
  onUpdate,
  onUpload,
}: {
  block: Block;
  onUpdate: (updates: Partial<Block>) => void;
  onUpload?: (blockId: string) => void;
}) {
  switch (block.type) {
    case "text":
      return <TextEditor block={block} onUpdate={onUpdate} />;
    case "image":
      return <ImageEditor block={block} onUpdate={onUpdate} onUpload={onUpload} />;
    case "button":
      return <ButtonEditor block={block} onUpdate={onUpdate} />;
    case "divider":
      return <DividerEditor />;
    case "spacer":
      return <SpacerEditor block={block} onUpdate={onUpdate} />;
    case "header":
      return <HeaderEditor block={block} onUpdate={onUpdate} />;
    case "social":
      return <SocialEditor block={block} onUpdate={onUpdate} />;
    case "video":
      return <VideoEditor block={block} onUpdate={onUpdate} />;
    case "quote":
      return <QuoteEditor block={block} onUpdate={onUpdate} onUpload={onUpload} />;
    case "columns":
      return <ColumnsEditor block={block} onUpdate={onUpdate} />;
    case "countdown":
      return <CountdownEditor block={block} onUpdate={onUpdate} />;
    case "tourcard":
      return <TourCardEditor block={block} onUpdate={onUpdate} onUpload={onUpload} />;
    case "footer":
      return <FooterEditor block={block} onUpdate={onUpdate} />;
    default:
      return null;
  }
}

/* ── Individual editors ── */

const EMAIL_FONTS = [
  { label: "Default", value: "" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Palatino", value: "'Palatino Linotype', 'Book Antiqua', Palatino, serif" },
  { label: "Lucida Sans", value: "'Lucida Sans Unicode', 'Lucida Grande', sans-serif" },
];

const FONT_WEIGHTS = [
  { label: "Light", value: "300" },
  { label: "Normal", value: "400" },
  { label: "Medium", value: "500" },
  { label: "Semi-Bold", value: "600" },
  { label: "Bold", value: "700" },
  { label: "Extra Bold", value: "800" },
];

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48];

function TextEditor({ block, onUpdate }: { block: TextBlock; onUpdate: (u: Partial<TextBlock>) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  // Track whether the user is actively editing so we don't clobber the DOM
  const editingRef = useRef(false);

  function execCmd(cmd: string) {
    // Re-focus the editor before executing (toolbar clicks steal focus)
    editorRef.current?.focus();
    document.execCommand(cmd, false);
    // Sync after a tick so the DOM settles
    setTimeout(() => {
      if (editorRef.current) onUpdate({ content: editorRef.current.innerHTML });
    }, 0);
  }

  function handleBlur() {
    editingRef.current = false;
    if (editorRef.current) {
      onUpdate({ content: editorRef.current.innerHTML });
    }
  }

  function handleFocus() {
    editingRef.current = true;
  }

  // Only set innerHTML from props when NOT actively editing (initial load / block switch)
  const lastSetRef = useRef(block.content);
  if (editorRef.current && !editingRef.current && block.content !== lastSetRef.current) {
    editorRef.current.innerHTML = block.content;
    lastSetRef.current = block.content;
  }

  const btnCls = "h-7 w-7 flex items-center justify-center rounded hover:bg-[var(--ck-bg-subtle)] transition-colors";
  const btnActive = "bg-[var(--ck-bg-subtle)]";
  const selectCls = "rounded border px-1.5 py-1 text-[11px] outline-none";

  return (
    <div>
      <Label>Text</Label>

      {/* ── Formatting Toolbar ── */}
      <div className="mt-1 flex flex-wrap items-center gap-1 rounded-t-lg border border-b-0 px-2 py-1.5" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg-subtle)" }}
        onMouseDown={(e) => e.preventDefault()} /* prevent toolbar clicks from stealing focus/selection */
      >
        {/* Font family */}
        <select
          value={block.fontFamily || ""}
          onChange={(e) => { onUpdate({ fontFamily: e.target.value || undefined }); editorRef.current?.focus(); }}
          className={selectCls}
          style={{ ...inputStyle, width: 110 }}
          title="Font"
          onMouseDown={(e) => e.stopPropagation()} /* allow select to open */
        >
          {EMAIL_FONTS.map((f) => (
            <option key={f.value} value={f.value} style={{ fontFamily: f.value || "inherit" }}>{f.label}</option>
          ))}
        </select>

        {/* Font size */}
        <select
          value={block.fontSize || 15}
          onChange={(e) => { onUpdate({ fontSize: Number(e.target.value) }); editorRef.current?.focus(); }}
          className={selectCls}
          style={{ ...inputStyle, width: 52 }}
          title="Font size"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>

        {/* Font weight */}
        <select
          value={block.fontWeight || "400"}
          onChange={(e) => { onUpdate({ fontWeight: e.target.value }); editorRef.current?.focus(); }}
          className={selectCls}
          style={{ ...inputStyle, width: 85 }}
          title="Font weight"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {FONT_WEIGHTS.map((w) => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
        </select>

        <div className="w-px h-5 mx-0.5" style={{ background: "var(--ck-border)" }} />

        {/* Inline formatting */}
        <button type="button" onClick={() => execCmd("bold")} className={btnCls} title="Bold"><TextB size={14} /></button>
        <button type="button" onClick={() => execCmd("italic")} className={btnCls} title="Italic"><TextItalic size={14} /></button>
        <button type="button" onClick={() => execCmd("underline")} className={btnCls} title="Underline"><TextUnderline size={14} /></button>

        <div className="w-px h-5 mx-0.5" style={{ background: "var(--ck-border)" }} />

        {/* Alignment */}
        <button type="button" onClick={() => { onUpdate({ textAlign: "left" }); editorRef.current?.focus(); }} className={`${btnCls} ${block.textAlign === "left" || !block.textAlign ? btnActive : ""}`} title="Align left"><TextAlignLeft size={14} /></button>
        <button type="button" onClick={() => { onUpdate({ textAlign: "center" }); editorRef.current?.focus(); }} className={`${btnCls} ${block.textAlign === "center" ? btnActive : ""}`} title="Align center"><TextAlignCenter size={14} /></button>
        <button type="button" onClick={() => { onUpdate({ textAlign: "right" }); editorRef.current?.focus(); }} className={`${btnCls} ${block.textAlign === "right" ? btnActive : ""}`} title="Align right"><TextAlignRight size={14} /></button>

        <div className="w-px h-5 mx-0.5" style={{ background: "var(--ck-border)" }} />

        {/* Text color */}
        <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          <input
            type="color"
            value={block.color || "#374151"}
            onChange={(e) => onUpdate({ color: e.target.value })}
            className="h-6 w-6 cursor-pointer rounded border-0 p-0"
            title="Text color"
          />
          <span className="text-[10px]" style={{ color: "var(--ck-text-muted)" }}>Color</span>
        </div>
      </div>

      {/* ── Content Editable Area ── */}
      <div
        ref={(el) => {
          (editorRef as any).current = el;
          // Set initial content once
          if (el && !editingRef.current && el.innerHTML !== block.content) {
            el.innerHTML = block.content;
            lastSetRef.current = block.content;
          }
        }}
        contentEditable
        suppressContentEditableWarning
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="w-full min-h-[100px] rounded-b-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--ck-accent)]"
        style={{
          ...inputStyle,
          fontFamily: block.fontFamily || "inherit",
          fontSize: (block.fontSize || 15) + "px",
          fontWeight: block.fontWeight || "400",
          color: block.color || "#374151",
          textAlign: (block.textAlign as any) || "left",
          lineHeight: 1.6,
        }}
      />

      <p className="mt-1 text-[10px]" style={{ color: "var(--ck-text-muted)" }}>
        Type directly — use the toolbar for formatting. Variables: {"{first_name}"}, {"{promo_code}"}, {"{voucher_code}"}
      </p>
    </div>
  );
}

function ImageEditor({ block, onUpdate, onUpload }: { block: ImageBlock; onUpdate: (u: Partial<ImageBlock>) => void; onUpload?: (id: string) => void }) {
  return (
    <div>
      <Label>Image</Label>
      <div className="mt-1 space-y-2">
        {block.src ? (
          <img src={block.src} alt={block.alt} className="max-h-40 rounded-lg object-contain" />
        ) : (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed" style={{ borderColor: "var(--ck-border)" }}>
            <button onClick={() => onUpload?.(block.id)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium" style={{ color: "var(--ck-accent)" }}>
              <ImageIcon size={14} /> Upload Image
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Alt text" value={block.alt} onChange={(e) => onUpdate({ alt: e.target.value })} className={inputCls} style={inputStyle} />
          <input placeholder="Width (e.g. 100%, 300px)" value={block.width} onChange={(e) => onUpdate({ width: e.target.value })} className={inputCls} style={inputStyle} />
        </div>
        {block.src && (
          <button onClick={() => onUpload?.(block.id)} className="text-xs font-medium" style={{ color: "var(--ck-accent)" }}>Replace image</button>
        )}
      </div>
    </div>
  );
}

function ButtonEditor({ block, onUpdate }: { block: ButtonBlock; onUpdate: (u: Partial<ButtonBlock>) => void }) {
  return (
    <div>
      <Label>Button</Label>
      <div className="mt-1 grid grid-cols-3 gap-2">
        <input placeholder="Button text" value={block.text} onChange={(e) => onUpdate({ text: e.target.value })} className={inputCls} style={inputStyle} />
        <input placeholder="URL" value={block.url} onChange={(e) => onUpdate({ url: e.target.value })} className={inputCls} style={inputStyle} />
        <div className="flex items-center gap-1">
          <input type="color" value={block.color} onChange={(e) => onUpdate({ color: e.target.value })} className="h-8 w-8 cursor-pointer rounded border-0" />
          <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Color</span>
        </div>
      </div>
    </div>
  );
}

function DividerEditor() {
  return (
    <div>
      <Label>Divider</Label>
      <hr className="mt-2 border-gray-200" />
    </div>
  );
}

function SpacerEditor({ block, onUpdate }: { block: SpacerBlock; onUpdate: (u: Partial<SpacerBlock>) => void }) {
  return (
    <div>
      <Label>Spacer</Label>
      <div className="mt-1 flex items-center gap-2">
        <input type="number" min={4} max={200} value={block.height} onChange={(e) => onUpdate({ height: parseInt(e.target.value) || 24 })} className={`w-24 ${inputCls}`} style={inputStyle} />
        <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>px height</span>
      </div>
      <div className="mt-2 rounded border border-dashed" style={{ height: Math.min(block.height, 60), borderColor: "var(--ck-border)" }} />
    </div>
  );
}

function HeaderEditor({ block, onUpdate }: { block: HeaderBlock; onUpdate: (u: Partial<HeaderBlock>) => void }) {
  return (
    <div>
      <Label>Header</Label>
      <div className="mt-1 grid grid-cols-[1fr_auto_auto] gap-2">
        <input placeholder="Heading text" value={block.text} onChange={(e) => onUpdate({ text: e.target.value })} className={inputCls} style={inputStyle} />
        <select value={block.level} onChange={(e) => onUpdate({ level: e.target.value as "h1" | "h2" | "h3" })} className={inputCls} style={inputStyle}>
          <option value="h1">H1</option>
          <option value="h2">H2</option>
          <option value="h3">H3</option>
        </select>
        <div className="flex items-center gap-1">
          <input type="color" value={block.color} onChange={(e) => onUpdate({ color: e.target.value })} className="h-8 w-8 cursor-pointer rounded border-0" />
        </div>
      </div>
    </div>
  );
}

function SocialEditor({ block, onUpdate }: { block: SocialBlock; onUpdate: (u: Partial<SocialBlock>) => void }) {
  const [expanded, setExpanded] = useState<string[]>(Object.keys(block.platforms));

  function togglePlatform(key: string) {
    const next = { ...block.platforms };
    if (key in next) {
      delete next[key];
      setExpanded(expanded.filter((k) => k !== key));
    } else {
      next[key] = SOCIAL_PLATFORMS[key]?.defaultUrl || "";
      setExpanded([...expanded, key]);
    }
    onUpdate({ platforms: next });
  }

  function updateUrl(key: string, url: string) {
    onUpdate({ platforms: { ...block.platforms, [key]: url } });
  }

  return (
    <div>
      <Label>Social Links</Label>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {Object.entries(SOCIAL_PLATFORMS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => togglePlatform(key)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all ${key in block.platforms ? "ring-2 shadow-sm" : "opacity-40 grayscale"}`}
            style={{ borderColor: key in block.platforms ? p.brandColor : "var(--ck-border)", color: "var(--ck-text)", outlineColor: key in block.platforms ? p.brandColor : undefined }}
          >
            <img src={p.icon} alt="" width="18" height="18" className="rounded" />
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-1.5">
        {Object.entries(block.platforms).map(([key, url]) => (
          <div key={key} className="flex items-center gap-2">
            <img src={SOCIAL_PLATFORMS[key]?.icon} alt="" width="22" height="22" className="rounded" />
            <span className="w-16 text-[11px] font-semibold" style={{ color: SOCIAL_PLATFORMS[key]?.brandColor || "var(--ck-text-muted)" }}>{SOCIAL_PLATFORMS[key]?.label || key}</span>
            <input value={url} onChange={(e) => updateUrl(key, e.target.value)} placeholder="URL" className={`flex-1 ${inputCls}`} style={inputStyle} />
          </div>
        ))}
      </div>
    </div>
  );
}

function VideoEditor({ block, onUpdate }: { block: VideoBlock; onUpdate: (u: Partial<VideoBlock>) => void }) {
  return (
    <div>
      <Label>Video</Label>
      <div className="mt-1 space-y-2">
        <input placeholder="Video URL (YouTube, Vimeo, etc.)" value={block.url} onChange={(e) => onUpdate({ url: e.target.value })} className={`w-full ${inputCls}`} style={inputStyle} />
        <input placeholder="Thumbnail URL (auto-detected for YouTube)" value={block.thumbnailUrl} onChange={(e) => onUpdate({ thumbnailUrl: e.target.value })} className={`w-full ${inputCls}`} style={inputStyle} />
        {(block.thumbnailUrl || block.url) && (
          <p className="text-[11px]" style={{ color: "var(--ck-text-muted)" }}>
            {block.thumbnailUrl ? "Custom thumbnail set" : block.url.includes("youtube") || block.url.includes("youtu.be") ? "YouTube thumbnail auto-detected" : "Add a thumbnail URL for best results"}
          </p>
        )}
      </div>
    </div>
  );
}

function QuoteEditor({ block, onUpdate, onUpload }: { block: QuoteBlock; onUpdate: (u: Partial<QuoteBlock>) => void; onUpload?: (id: string) => void }) {
  return (
    <div>
      <Label>Quote</Label>
      <div className="mt-1 space-y-2">
        <textarea value={block.text} onChange={(e) => onUpdate({ text: e.target.value })} rows={3} className={`w-full ${inputCls}`} style={inputStyle} placeholder="Enter quote text..." />
        <input placeholder="Attribution (e.g. Jane D., Customer)" value={block.attribution} onChange={(e) => onUpdate({ attribution: e.target.value })} className={`w-full ${inputCls}`} style={inputStyle} />
        <div className="flex items-center gap-2">
          {block.photoUrl ? (
            <>
              <img src={block.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
              <button onClick={() => onUpdate({ photoUrl: "" })} className="text-xs" style={{ color: "var(--ck-text-muted)" }}><X size={12} /> Remove</button>
            </>
          ) : (
            <button onClick={() => onUpload?.(block.id)} className="text-xs font-medium" style={{ color: "var(--ck-accent)" }}>
              <ImageIcon size={12} className="inline mr-1" />Add photo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ColumnsEditor({ block, onUpdate }: { block: ColumnsBlock; onUpdate: (u: Partial<ColumnsBlock>) => void }) {
  const ALLOWED_TYPES = ["text", "image", "button"] as const;

  function addSubBlock(colIdx: number, type: Block["type"]) {
    const cols = block.columns.map((c) => [...c]);
    cols[colIdx].push(createBlock(type));
    onUpdate({ columns: cols });
  }

  function removeSubBlock(colIdx: number, blockIdx: number) {
    const cols = block.columns.map((c) => [...c]);
    cols[colIdx].splice(blockIdx, 1);
    onUpdate({ columns: cols });
  }

  function updateSubBlock(colIdx: number, blockIdx: number, updates: Partial<Block>) {
    const cols = block.columns.map((c) => [...c]);
    cols[colIdx][blockIdx] = { ...cols[colIdx][blockIdx], ...updates } as Block;
    onUpdate({ columns: cols });
  }

  function setColumnCount(n: 2 | 3) {
    const cols = [...block.columns.map((c) => [...c])];
    while (cols.length < n) cols.push([]);
    while (cols.length > n) cols.pop();
    onUpdate({ columnCount: n, columns: cols });
  }

  return (
    <div>
      <Label>Columns</Label>
      <div className="mt-1 flex items-center gap-2 mb-2">
        <select value={block.columnCount} onChange={(e) => setColumnCount(parseInt(e.target.value) as 2 | 3)} className={inputCls} style={inputStyle}>
          <option value={2}>2 Columns</option>
          <option value={3}>3 Columns</option>
        </select>
      </div>
      <div className={`grid gap-2 ${block.columnCount === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {block.columns.slice(0, block.columnCount).map((col, ci) => (
          <div key={ci} className="rounded-lg border p-2 space-y-1" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)" }}>
            <span className="text-[10px] font-medium" style={{ color: "var(--ck-text-muted)" }}>Col {ci + 1}</span>
            {col.map((sub, si) => (
              <div key={sub.id} className="flex items-start gap-1 rounded border p-1.5" style={{ borderColor: "var(--ck-border)" }}>
                <div className="flex-1 min-w-0">
                  {sub.type === "text" && (
                    <textarea value={(sub as TextBlock).content} onChange={(e) => updateSubBlock(ci, si, { content: e.target.value })} rows={2} className={`w-full ${inputCls} font-mono text-[11px]`} style={inputStyle} />
                  )}
                  {sub.type === "image" && (
                    <input placeholder="Image URL" value={(sub as ImageBlock).src} onChange={(e) => updateSubBlock(ci, si, { src: e.target.value })} className={`w-full ${inputCls} text-[11px]`} style={inputStyle} />
                  )}
                  {sub.type === "button" && (
                    <div className="space-y-1">
                      <input placeholder="Text" value={(sub as ButtonBlock).text} onChange={(e) => updateSubBlock(ci, si, { text: e.target.value })} className={`w-full ${inputCls} text-[11px]`} style={inputStyle} />
                      <input placeholder="URL" value={(sub as ButtonBlock).url} onChange={(e) => updateSubBlock(ci, si, { url: e.target.value })} className={`w-full ${inputCls} text-[11px]`} style={inputStyle} />
                    </div>
                  )}
                </div>
                <button onClick={() => removeSubBlock(ci, si)} className="text-red-500 p-0.5"><Trash size={10} /></button>
              </div>
            ))}
            <div className="flex gap-1">
              {ALLOWED_TYPES.map((t) => (
                <button key={t} onClick={() => addSubBlock(ci, t)} className="rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text-muted)" }}>
                  <Plus size={8} className="inline" /> {t}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CountdownEditor({ block, onUpdate }: { block: CountdownBlock; onUpdate: (u: Partial<CountdownBlock>) => void }) {
  return (
    <div>
      <Label>Countdown</Label>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <input type="datetime-local" value={block.targetDate} onChange={(e) => onUpdate({ targetDate: e.target.value })} className={inputCls} style={inputStyle} />
        <input placeholder="Label (e.g. Offer ends in)" value={block.label} onChange={(e) => onUpdate({ label: e.target.value })} className={inputCls} style={inputStyle} />
      </div>
    </div>
  );
}

function TourCardEditor({ block, onUpdate, onUpload }: { block: TourCardBlock; onUpdate: (u: Partial<TourCardBlock>) => void; onUpload?: (id: string) => void }) {
  return (
    <div>
      <Label>Tour Card</Label>
      <div className="mt-1 space-y-2">
        {block.imageUrl ? (
          <div>
            <img src={block.imageUrl} alt="" className="max-h-32 rounded-lg object-cover" />
            <button onClick={() => onUpload?.(block.id)} className="mt-1 text-xs font-medium" style={{ color: "var(--ck-accent)" }}>Replace</button>
          </div>
        ) : (
          <button onClick={() => onUpload?.(block.id)} className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs font-medium" style={{ borderColor: "var(--ck-border)", color: "var(--ck-accent)" }}>
            <ImageIcon size={14} /> Upload Tour Image
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Tour title" value={block.title} onChange={(e) => onUpdate({ title: e.target.value })} className={inputCls} style={inputStyle} />
          <input placeholder="Price (e.g. R 350)" value={block.price} onChange={(e) => onUpdate({ price: e.target.value })} className={inputCls} style={inputStyle} />
          <input placeholder="CTA text" value={block.ctaText} onChange={(e) => onUpdate({ ctaText: e.target.value })} className={inputCls} style={inputStyle} />
          <input placeholder="CTA URL" value={block.ctaUrl} onChange={(e) => onUpdate({ ctaUrl: e.target.value })} className={inputCls} style={inputStyle} />
        </div>
      </div>
    </div>
  );
}

function FooterEditor({ block, onUpdate }: { block: FooterBlock; onUpdate: (u: Partial<FooterBlock>) => void }) {
  function updateSocial(key: string, url: string) {
    onUpdate({ socials: { ...block.socials, [key]: url } });
  }

  function toggleSocial(key: string) {
    const next = { ...block.socials };
    if (key in next) {
      delete next[key];
    } else {
      next[key] = SOCIAL_PLATFORMS[key]?.defaultUrl || "";
    }
    onUpdate({ socials: next });
  }

  return (
    <div>
      <Label>Footer</Label>
      <div className="mt-1 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <input placeholder="Company name" value={block.companyName} onChange={(e) => onUpdate({ companyName: e.target.value })} className={inputCls} style={inputStyle} />
          <input placeholder="Address" value={block.address} onChange={(e) => onUpdate({ address: e.target.value })} className={inputCls} style={inputStyle} />
          <input placeholder="Phone" value={block.phone} onChange={(e) => onUpdate({ phone: e.target.value })} className={inputCls} style={inputStyle} />
        </div>
        <div>
          <span className="text-[10px] font-medium" style={{ color: "var(--ck-text-muted)" }}>Social links</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {Object.entries(SOCIAL_PLATFORMS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => toggleSocial(key)}
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-all ${key in (block.socials || {}) ? "ring-2 shadow-sm" : "opacity-40 grayscale"}`}
                style={{ borderColor: key in (block.socials || {}) ? p.brandColor : "var(--ck-border)", color: "var(--ck-text)", outlineColor: key in (block.socials || {}) ? p.brandColor : undefined }}
              >
                <img src={p.icon} alt="" width="16" height="16" className="rounded" />
                {p.label}
              </button>
            ))}
          </div>
          {Object.entries(block.socials || {}).map(([key, url]) => (
            <div key={key} className="mt-1 flex items-center gap-2">
              <img src={SOCIAL_PLATFORMS[key]?.icon} alt="" width="20" height="20" className="rounded" />
              <span className="w-16 text-[10px] font-semibold" style={{ color: SOCIAL_PLATFORMS[key]?.brandColor }}>{SOCIAL_PLATFORMS[key]?.label || key}</span>
              <input value={url} onChange={(e) => updateSocial(key, e.target.value)} placeholder="URL" className={`flex-1 ${inputCls}`} style={inputStyle} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
