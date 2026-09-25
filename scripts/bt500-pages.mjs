export async function fetchAllPages(fetchPage, { pageSize = 1000, maxPages = 10 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage(page * pageSize, (page + 1) * pageSize - 1);
    if (!Array.isArray(batch)) throw new Error("page loader must return an array");
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error(`pagination exceeded the ${pageSize * maxPages}-row safety limit`);
}
