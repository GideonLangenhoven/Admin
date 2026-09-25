import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllPages } from "../../scripts/bt500-pages.mjs";

test("fetchAllPages reads beyond PostgREST's 1000-row default", async () => {
  const source = Array.from({ length: 2505 }, (_, id) => ({ id }));
  const ranges = [];
  const rows = await fetchAllPages(async (from, to) => {
    ranges.push([from, to]);
    return source.slice(from, to + 1);
  });
  assert.deepEqual(rows, source);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("fetchAllPages fails at its configured safety bound", async () => {
  await assert.rejects(
    fetchAllPages(async (from, to) => Array.from({ length: to - from + 1 }), { pageSize: 2, maxPages: 2 }),
    /4-row safety limit/,
  );
});
