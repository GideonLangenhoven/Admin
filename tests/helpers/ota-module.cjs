// Execute actual edge modules with network disabled and no Deno/env access.
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript");
const cache = new Map();
module.exports = function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  cache.set(file, mod.exports);
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(source, {
    module: mod,
    exports: mod.exports,
    require: (name) => {
      if (!name.startsWith(".")) throw new Error("Unexpected import " + name);
      return load(path.resolve(path.dirname(file), name));
    },
    console,
    crypto: require("node:crypto").webcrypto,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    Intl,
    Date,
    btoa,
    atob,
    AbortSignal,
    fetch: () => {
      throw new Error("Network disabled");
    },
  }, { filename: file });
  return mod.exports;
};
