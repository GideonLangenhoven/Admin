"use client";
import { useState } from "react";
import { Image as ImageIcon, Plus, Trash2, X } from "lucide-react";
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

var inputCls = "rounded-lg border px-2 py-1.5 text-xs";
var inputStyle = { borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" };
var labelCls = "text-[10px] font-semibold uppercase tracking-wider";
var labelStyle = { color: "var(--ck-text-muted)" };

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

function TextEditor({ block, onUpdate }: { block: TextBlock; onUpdate: (u: Partial<TextBlock>) => void }) {
  return (
    <div>
      <Label>Text</Label>
      <textarea
        value={block.content}
        onChange={(e) => onUpdate({ content: e.target.value })}
        rows={4}
        className={`mt-1 w-full ${inputCls} font-mono`}
        style={inputStyle}
        placeholder="Write HTML content... Use <p>, <b>, <a> tags. {first_name} for personalization."
      />
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
  var [expanded, setExpanded] = useState<string[]>(Object.keys(block.platforms));

  function togglePlatform(key: string) {
    var next = { ...block.platforms };
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
      <div className="mt-1 flex flex-wrap gap-1">
        {Object.entries(SOCIAL_PLATFORMS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => togglePlatform(key)}
            className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${key in block.platforms ? "ring-1" : "opacity-50"}`}
            style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)", ...(key in block.platforms ? { ringColor: "var(--ck-accent)" } : {}) }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-1">
        {Object.entries(block.platforms).map(([key, url]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-20 text-[11px] font-medium" style={{ color: "var(--ck-text-muted)" }}>{SOCIAL_PLATFORMS[key]?.label || key}</span>
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
  var ALLOWED_TYPES = ["text", "image", "button"] as const;

  function addSubBlock(colIdx: number, type: Block["type"]) {
    var cols = block.columns.map((c) => [...c]);
    cols[colIdx].push(createBlock(type));
    onUpdate({ columns: cols });
  }

  function removeSubBlock(colIdx: number, blockIdx: number) {
    var cols = block.columns.map((c) => [...c]);
    cols[colIdx].splice(blockIdx, 1);
    onUpdate({ columns: cols });
  }

  function updateSubBlock(colIdx: number, blockIdx: number, updates: Partial<Block>) {
    var cols = block.columns.map((c) => [...c]);
    cols[colIdx][blockIdx] = { ...cols[colIdx][blockIdx], ...updates } as Block;
    onUpdate({ columns: cols });
  }

  function setColumnCount(n: 2 | 3) {
    var cols = [...block.columns.map((c) => [...c])];
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
                <button onClick={() => removeSubBlock(ci, si)} className="text-red-500 p-0.5"><Trash2 size={10} /></button>
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
    var next = { ...block.socials };
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
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(SOCIAL_PLATFORMS).map(([key, p]) => (
              <button
                key={key}
                onClick={() => toggleSocial(key)}
                className={`rounded border px-1.5 py-0.5 text-[10px] ${key in (block.socials || {}) ? "font-semibold" : "opacity-50"}`}
                style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {Object.entries(block.socials || {}).map(([key, url]) => (
            <div key={key} className="mt-1 flex items-center gap-2">
              <span className="w-20 text-[10px]" style={{ color: "var(--ck-text-muted)" }}>{SOCIAL_PLATFORMS[key]?.label || key}</span>
              <input value={url} onChange={(e) => updateSocial(key, e.target.value)} placeholder="URL" className={`flex-1 ${inputCls}`} style={inputStyle} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
