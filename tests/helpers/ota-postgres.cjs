// Test-only PostgREST-shaped transport backed by a disposable PostgreSQL client.
// Domain logic stays in the real supplier backend and migration, not this helper.
module.exports = function transport(client) {
  const quote = (name) => {
    if (!/^[a-z_]+$/.test(name)) throw new Error("Bad identifier");
    return '"' + name + '"';
  };
  return {
    rpc: async (name, args = {}) => {
      try {
        const values = Object.values(args);
        const result = await client.query(
          "SELECT " + quote(name) + "(" + Object.keys(args).map((k, i) =>
            quote(k) + "=> $" + (i + 1)
          ).join(",") + ") AS result",
          values,
        );
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from: (table) => {
      let columns = "*",
        order = "",
        limit = "",
        single = false,
        write = null,
        conflict = "";
      const filters = [], values = [];
      const query = {
        update: (value) => {
          write = { kind: "update", value };
          return query;
        },
        upsert: (value, options) => {
          write = { kind: "upsert", value };
          conflict = options.onConflict;
          return query;
        },
        select: (value) => {
          columns = value.split(",").map(quote).join(",");
          return query;
        },
        eq: (col, val) => {
          values.push(val);
          filters.push(quote(col) + "=$" + values.length);
          return query;
        },
        is: (col) => {
          filters.push(quote(col) + " IS NULL");
          return query;
        },
        gte: (col, val) => {
          values.push(val);
          filters.push(quote(col) + ">=$" + values.length);
          return query;
        },
        lte: (col, val) => {
          values.push(val);
          filters.push(quote(col) + "<=$" + values.length);
          return query;
        },
        order: (col) => {
          order = " ORDER BY " + quote(col);
          return query;
        },
        range: (from, to) => {
          limit = " LIMIT " + (to - from + 1) + " OFFSET " + from;
          return query;
        },
        limit: (n) => {
          limit = " LIMIT " + n;
          return query;
        },
        single: () => {
          single = true;
          return query;
        },
        maybeSingle: () => {
          single = true;
          return query;
        },
        then: (resolve, reject) => {
          let sql = "SELECT " + columns + " FROM " + quote(table) +
            (filters.length ? " WHERE " + filters.join(" AND ") : "") + order +
            limit;
          let params = values;
          if (write) {
            const entries = Object.entries(write.value);
            params = [...values, ...entries.map(([, v]) => v)];
            const assignments = entries.map(([k], i) =>
              quote(k) + "=$" + (values.length + i + 1)
            ).join(",");
            if (write.kind === "update") {
              sql = "UPDATE " + quote(table) + " SET " + assignments +
                (filters.length ? " WHERE " + filters.join(" AND ") : "");
            } else {sql = "INSERT INTO " + quote(table) + "(" +
                entries.map(([k]) => quote(k)).join(",") + ") VALUES(" +
                entries.map((_, i) => "$" + (values.length + i + 1)).join(",") +
                ") ON CONFLICT(" + conflict.split(",").map(quote).join(",") +
                ") DO UPDATE SET " + entries.map(([k]) =>
                  quote(k) + "=EXCLUDED." + quote(k)
                ).join(",");}
          }
          return client.query(sql, params).then(
            (r) =>
              resolve({
                data: single ? r.rows[0] || null : r.rows,
                error: null,
              }),
            (e) => resolve({ data: null, error: e }),
          ).catch(reject);
        },
      };
      return query;
    },
  };
};
