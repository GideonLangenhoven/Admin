import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatZar } from "../../app/lib/money";

// P2: one ZAR format on admin screens, R1 200,00, not R0.00 or R2,000.
// CSV exports and API payloads keep plain 1200.00 and are not matched here.
const HAND_FORMATTED = [
  /\bR\$?\{[^}]*\.toFixed\(/, //                      R{x.toFixed(2)}
  /\bR\$?\{[^}]*\.toLocaleString\((\)|"en-ZA"\))/, //  R{x.toLocaleString()}
  /"R" \+ [\w.()?]*\.toFixed\(2\)/, //                 "R" + x.toFixed(2)
  /\bR\$?\{(Number\()?[\w.?]+\)?\}/, //                R{x}, R${Number(x)}
  /style: "currency", currency: "ZAR"/, //             "R 1 200,00"
];
// Mirrors the booking site's tour card, which has its own format.
const ALLOWED = new Set(["components/booking/Catalogue.tsx"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return path === "app/api" ? [] : sources(path);
    return /\.tsx?$/.test(e.name) ? [path] : [];
  });
}

describe("ZAR money format", () => {
  it("formats rands with a space for thousands and two decimals", () => {
    expect(formatZar(1200)).toBe("R1 200,00");
    expect(formatZar(0)).toBe("R0,00");
    expect(formatZar(2000.5)).toBe("R2 000,50");
  });

  it("leaves no hand-formatted amounts on admin screens", () => {
    const found = [...sources("app"), ...sources("components")]
      .filter(file => !ALLOWED.has(file))
      .flatMap(file => readFileSync(file, "utf8").split("\n")
        .map((line, i) => `${file}:${i + 1}: ${line.trim()}`)
        .filter(line => HAND_FORMATTED.some(re => re.test(line))));
    expect(found).toEqual([]);
  });
});
