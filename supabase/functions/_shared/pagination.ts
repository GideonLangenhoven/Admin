/** Page a deterministic, tenant-scoped query past PostgREST's row limit. */
export async function fetchAllRows<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}

/** PostgREST-shaped result for callers that already handle data/error pairs. */
export async function fetchAllRowsResult<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
) {
  try { return { data: await fetchAllRows(build), error: null }; }
  catch (error) { return { data: null, error }; }
}
