import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { normalize24HourTime } from "../../app/lib/admin-timezone";
import { sourceExports } from "../helpers/source-handler";

const source = readFileSync("app/settings/page.tsx", "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let input: ts.JsxSelfClosingElement | undefined;
function visit(node: ts.Node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "input" && node.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(ast) === "aria-describedby" && p.initializer?.getText(ast) === '"tour-time-hint"')) input = node;
  ts.forEachChild(node, visit);
}
visit(ast);
if (!input) throw new Error("Tour start time input missing");
const code = ts.transpileModule(`const input = (${input.getText(ast)});`, {
  fileName: "time-input.tsx", compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText + "\ninput";
const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });

describe("continuous tour time entry", () => {
  function fixture(initial = "") {
    let tourForm = { slotTimes: [initial] };
    const render = () => runInNewContext(code, {
      exports: {}, require: () => ({ jsx }), idx: 0, t: tourForm.slotTimes[0], tourForm, normalize24HourTime,
      setTourForm: (next: typeof tourForm | ((prev: typeof tourForm) => typeof tourForm)) => { tourForm = typeof next === "function" ? next(tourForm) : next; },
    }).props;
    return { render, value: () => tourForm.slotTimes[0] };
  }
  it("allows a single continuous 1800 entry and immediately displays 18:00", () => {
    const f = fixture();
    expect(f.render()).toMatchObject({ type: "text", inputMode: "numeric" });
    for (const value of ["1", "18", "180", "1800"]) f.render().onChange({ target: { value } });
    expect(f.value()).toBe("18:00");
  });
  it("formats a shorter time on blur and permits clearing it", () => {
    const f = fixture();
    f.render().onChange({ target: { value: "930" } });
    f.render().onBlur();
    expect(f.value()).toBe("09:30");
    f.render().onChange({ target: { value: "" } });
    expect(f.value()).toBe("");
  });
  it("leaves invalid times visible for validation rather than rolling over", () => {
    const f = fixture();
    f.render().onChange({ target: { value: "2460" } });
    f.render().onBlur();
    expect(f.value()).toBe("2460");
  });
  it("selects the existing time so it can be replaced in one continuous entry", () => {
    const select = vi.fn();
    fixture("18:00").render().onFocus({ currentTarget: { select } });
    expect(select).toHaveBeenCalledOnce();
  });
});

describe("tour schedule display", () => {
  it("groups and sorts midnight, morning and evening slots in SAST, regardless of browser timezone", () => {
    const slots = [
      { id: "evening", start_time: "2026-10-12T16:00:00Z", capacity_total: 10, booked: 0, held: 0 },
      { id: "midnight", start_time: "2026-10-11T22:00:00Z", capacity_total: 10, booked: 0, held: 0 },
      { id: "morning", start_time: "2026-10-12T07:00:00Z", capacity_total: 10, booked: 0, held: 0 },
    ];
    const component = sourceExports("components/InlineSlotManager.tsx", {
      "react": { useState: (initial: unknown) => [Array.isArray(initial) ? slots : initial === true ? false : initial, vi.fn()], useEffect: vi.fn(), useMemo: (fn: () => unknown) => fn() },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "../app/lib/supabase": {}, "../app/lib/app-notify": {}, "../app/lib/admin-timezone": {},
    }).default as (props: object) => unknown;
    const tree = component({ tourId: "tour", businessId: "operator", timezone: "Africa/Johannesburg" });
    const times: string[] = [];
    function collect(node: unknown) {
      if (typeof node === "string" && /^\d{2}:\d{2}$/.test(node)) times.push(node);
      else if (Array.isArray(node)) node.forEach(collect);
      else if (node && typeof node === "object" && "props" in node) collect((node as { props: { children: unknown } }).props.children);
    }
    collect(tree);
    expect(times).toEqual(["00:00", "09:00", "18:00"]);
  });
});
