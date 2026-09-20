"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ShieldCheck, X } from "@phosphor-icons/react";
import { getDemoActionExplanation, isDemoPathVisible, type DemoActionExplanation } from "@/app/lib/demo-guide";
import { useBusinessContext } from "./BusinessContext";

// Section introductions also explain settings without a dedicated save button.
export function DemoFeatureLink({ feature }: { feature: string }) {
  const { readOnly } = useBusinessContext();
  const explanation = getDemoActionExplanation(feature);
  if (!readOnly || !explanation) return null;
  return <button type="button" data-demo-action={feature}
    className="mb-3 inline-flex min-h-11 items-center gap-2 text-left text-sm font-medium underline underline-offset-4"
    style={{ color: "var(--ck-accent)" }}>
    <ShieldCheck size={17} aria-hidden="true" />{explanation.title}
  </button>;
}

export default function DemoActionGuide({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [explanation, setExplanation] = useState<DemoActionExplanation | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const modal = dialog.current;
    if (explanation && modal && !modal.open) modal.showModal();
    return () => { if (modal?.open) modal.close(); };
  }, [explanation]);

  function stop(event: React.SyntheticEvent) {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
  }

  function explain(event: React.SyntheticEvent, control: HTMLElement | null) {
    const id = control?.dataset.demoAction || control?.dataset.demoSubmit;
    if (!id) return false;
    stop(event);
    const next = getDemoActionExplanation(id, control?.dataset.demoSubject);
    if (next) {
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ck:demo-explanation-open"));
      setExplanation(next);
    }
    return true;
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-demo-live]")) return;
    if (explain(event, target.closest<HTMLElement>("[data-demo-action]"))) return;
    const button = target.closest<HTMLButtonElement>("button");
    if (button?.type === "submit" && explain(event, button.form?.closest<HTMLElement>("[data-demo-submit]") || null)) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (link && !isDemoPathVisible(link.getAttribute("href") || "")) stop(event);
  }

  function handleSubmit(event: React.FormEvent<HTMLDivElement>) {
    const form = event.target as HTMLFormElement;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const control = submitter?.closest<HTMLElement>("[data-demo-action]")
      || form.closest<HTMLElement>("[data-demo-submit]")
      || form.querySelector<HTMLElement>("button[type=submit][data-demo-action], [data-demo-action]");
    // Fail closed even if a newly added form has not yet been catalogued.
    if (!explain(event, control)) stop(event);
  }

  return <div className="contents" onClickCapture={handleClick} onSubmitCapture={handleSubmit}
    onChangeCapture={(event) => explain(event, (event.target as HTMLElement).closest("[data-demo-action]"))}
    onKeyDownCapture={(event) => {
      if (event.key === "Enter" && !(event.target as HTMLElement).matches("button")) {
        const control = (event.target as HTMLElement).closest<HTMLElement>("[data-demo-enter]");
        if (control) {
          stop(event);
          setExplanation(getDemoActionExplanation(control.dataset.demoEnter!));
        }
      }
    }}
    onPointerDownCapture={(event) => {
      const control = (event.target as HTMLElement).closest<HTMLButtonElement>("button:disabled");
      if (control) explain(event, control.dataset.demoAction ? control : control.form?.closest<HTMLElement>("[data-demo-submit]") || null);
    }}
    onDragStartCapture={(event) => {
      const control = (event.target as HTMLElement).closest<HTMLElement>("[data-demo-drag]");
      if (control) { stop(event); setExplanation(getDemoActionExplanation(control.dataset.demoDrag!)); }
    }}
    onDropCapture={(event) => {
      if (!event.dataTransfer.files.length) return;
      stop(event);
      setExplanation(getDemoActionExplanation(pathname === "/photos" ? "photo.upload" : "template.image"));
    }}>
    {children}
    {explanation && createPortal(
      <dialog ref={dialog} data-demo-live aria-labelledby="demo-explanation-title" aria-describedby="demo-explanation-content"
        onCancel={() => setExplanation(null)} onClose={() => setExplanation(null)}
        onClick={(event) => { if (event.target === event.currentTarget) setExplanation(null); }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border p-0 shadow-2xl backdrop:bg-slate-950/40"
        style={{ background: "var(--ck-surface-elevated)", borderColor: "var(--ck-border-strong)", color: "var(--ck-text-strong)" }}>
        <header className="flex items-start gap-3 border-b px-5 py-4 sm:px-6"
          style={{ background: "var(--ck-accent-soft)", borderColor: "var(--ck-border-subtle)" }}>
          <ShieldCheck size={24} weight="fill" className="mt-0.5 shrink-0" style={{ color: "var(--ck-accent)" }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="ui-mono-label mb-1">Guided demo</p>
            <h2 id="demo-explanation-title" className="text-lg font-semibold leading-tight">
              <Link href={explanation.href} onClick={(event) => {
                if (explanation.href.startsWith(pathname + "#")) {
                  event.preventDefault();
                  window.location.hash = explanation.href.split("#")[1];
                }
                setExplanation(null);
              }}
                className="inline-flex items-center gap-1.5 underline decoration-1 underline-offset-4 hover:opacity-75">
                {explanation.title}<ArrowUpRight size={17} className="shrink-0" aria-hidden="true" />
              </Link>
            </h2>
          </div>
          <button type="button" autoFocus onClick={() => setExplanation(null)} aria-label="Close explanation"
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-black/5">
            <X size={18} />
          </button>
        </header>
        <div id="demo-explanation-content" className="px-5 py-5 sm:px-6">
          <dl className="space-y-4">
            <div><dt className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ck-accent)" }}>What this does</dt>
              <dd className="mt-1 text-sm leading-6">{explanation.operator}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ck-accent)" }}>What to know</dt>
              <dd className="mt-1 text-sm leading-6">{explanation.result}</dd></div>
          </dl>
          <p className="mt-5 border-t pt-4 text-xs" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>
            Demo only. Nothing was changed or sent.
          </p>
        </div>
      </dialog>, document.body)}
  </div>;
}
