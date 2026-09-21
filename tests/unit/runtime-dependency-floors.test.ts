import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type PackageMetadata = {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as PackageMetadata;
const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
  packages: Record<string, PackageMetadata>;
};

const installedVersion = (name: string) =>
  (JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")) as PackageMetadata).version;

const lockedVersions = (name: string) =>
  Object.entries(lock.packages)
    .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
    .map(([, metadata]) => metadata.version);

const versionAtLeast = (version: string | undefined, floor: string) => {
  if (!version) return false;
  const parts = version.split("-")[0].split(".").map(Number);
  const floorParts = floor.split(".").map(Number);
  for (let index = 0; index < floorParts.length; index += 1) {
    if (parts[index] !== floorParts[index]) return parts[index] > floorParts[index];
  }
  return true;
};

describe("runtime dependency security floors", () => {
  it("keeps the direct Next toolchain exactly aligned", () => {
    expect(manifest.dependencies?.next).toBe("16.3.3");
    expect(manifest.dependencies?.["@next/bundle-analyzer"]).toBe("16.3.3");
    expect(manifest.devDependencies?.["eslint-config-next"]).toBe("16.3.3");

    const root = lock.packages[""];
    expect(root.dependencies?.next).toBe("16.3.3");
    expect(root.dependencies?.["@next/bundle-analyzer"]).toBe("16.3.3");
    expect(root.devDependencies?.["eslint-config-next"]).toBe("16.3.3");

    expect(lock.packages["node_modules/next"].version).toBe("16.3.3");
    expect(lock.packages["node_modules/@next/bundle-analyzer"].version).toBe("16.3.3");
    expect(lock.packages["node_modules/eslint-config-next"].version).toBe("16.3.3");
    expect(installedVersion("next")).toBe("16.3.3");
    expect(installedVersion("@next/bundle-analyzer")).toBe("16.3.3");
    expect(installedVersion("eslint-config-next")).toBe("16.3.3");
  });

  it("locks and installs patched PostCSS and Sharp versions", () => {
    expect(manifest.devDependencies?.postcss).toBe("8.5.23");
    expect(lock.packages[""].devDependencies?.postcss).toBe("8.5.23");
    expect(installedVersion("postcss")).toBe("8.5.23");
    expect(lockedVersions("postcss").every((version) => versionAtLeast(version, "8.5.23"))).toBe(true);

    expect(manifest.dependencies?.sharp).toBe("0.35.4");
    expect(lock.packages[""].dependencies?.sharp).toBe("0.35.4");
    expect(installedVersion("sharp")).toBe("0.35.4");
    expect(lockedVersions("sharp").every((version) => versionAtLeast(version, "0.35.4"))).toBe(true);
    expect(lockedVersions("next").every((version) => versionAtLeast(version, "16.3.3"))).toBe(true);
  });

  it("uses patched test tooling and replaces the vulnerable xlsx reader", () => {
    expect(manifest.devDependencies?.vitest).toBe("^4.1.11");
    expect(manifest.devDependencies?.vite).toBe("^7.1.7");
    expect(versionAtLeast(installedVersion("vitest"), "4.1.11")).toBe(true);
    expect(versionAtLeast(installedVersion("vite"), "7.1.7")).toBe(true);

    expect(manifest.dependencies?.xlsx).toBeUndefined();
    expect(lock.packages["node_modules/xlsx"]).toBeUndefined();
    expect(manifest.dependencies?.["read-excel-file"]).toBe("^9.3.10");
    expect(lock.packages[""].dependencies?.["read-excel-file"]).toBe("^9.3.10");
    expect(installedVersion("read-excel-file")).toBe("9.3.10");
  });
});
