import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Run the actual Next/edge handler with explicit in-memory dependencies. Any
// unexpected import or network access fails the test instead of touching users.
function loadSource(
  file: string,
  mocks: Record<string, unknown>,
  env: Record<string, string> = {},
  fetchImpl: typeof fetch = () => { throw new Error("Network disabled in source-handler tests"); },
) {
  const sandboxModule = { exports: {} as Record<string, unknown> };
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(source, {
    module: sandboxModule, exports: sandboxModule.exports, console, Request, Response, Headers, URL, URLSearchParams, Date,
    TextEncoder, TextDecoder, atob, btoa, crypto: webcrypto, setTimeout, clearTimeout, AbortSignal,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-".repeat(8), ...env } },
    Deno: { serve: (fn: typeof handler) => { handler = fn; }, env: { get: (key: string) => env[key] || "" } },
    require: (name: string) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === "crypto") return require("node:crypto");
      if (name === "next/server") return { NextResponse: { json: (body: unknown, options?: ResponseInit) => Response.json(body, options) } };
      if (name.startsWith("jsr:") && name.endsWith(".d.ts")) return {};
      // Execute the real telemetry wrapper with delivery disabled unless the
      // test explicitly supplies a DSN and a network stub.
      if (name === "../_shared/sentry.ts") return loadSource("supabase/functions/_shared/sentry.ts", {}, env, fetchImpl).exports;
      throw new Error("Unexpected handler import: " + name);
    },
    fetch: fetchImpl,
  }, { filename: file });
  return { handler, exports: sandboxModule.exports };
}

export function sourceHandler(...args: Parameters<typeof loadSource>): (request: Request) => Promise<Response> {
  const loaded = loadSource(...args);
  return loaded.handler || loaded.exports.POST as (request: Request) => Promise<Response>;
}

export function sourceExports(...args: Parameters<typeof loadSource>): Record<string, unknown> {
  return loadSource(...args).exports;
}

// Exercise a real component's nested data-loading function without a DOM.
// Only its dependencies/state setters are supplied; the function body is not
// copied into the test. Missing dependencies fail, and network stays disabled.
export function sourceFunction(file: string, name: string, bindings: Record<string, unknown>): (...args: any[]) => any {
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let node: ts.FunctionDeclaration | undefined;
  function visit(child: ts.Node) {
    if (ts.isFunctionDeclaration(child) && child.name?.text === name) node = child;
    ts.forEachChild(child, visit);
  }
  visit(ast);
  if (!node) throw new Error("Missing source function: " + name);
  const code = ts.transpileModule(node.getText(ast).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(code + "\n" + name, {
    console, URL, setTimeout, clearTimeout,
    fetch: () => { throw new Error("Network disabled in source-function tests"); },
    ...bindings,
  }, { filename: file });
}
