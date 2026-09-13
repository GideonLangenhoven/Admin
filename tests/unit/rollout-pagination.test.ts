import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { fetchAllRows, fetchAllRowsResult } from "../../supabase/functions/_shared/pagination";
import { zonedToUtc } from "../../app/lib/admin-timezone";
import { amountReceived, amountRefunded } from "../../app/lib/report-accounting";
import { sourceExports, sourceFunction } from "../helpers/source-handler";

function queryClient(run: (query: any) => any) {
  const requests: any[] = [];
  function query(table: string, args?: any) {
    const q: any = { table, args, calls: [] };
    for (const method of ["select", "eq", "gte", "gt", "lt", "lte", "or", "order", "range", "in"]) {
      q[method] = (...values: any[]) => { q.calls.push([method, ...values]); return q; };
    }
    q.then = (resolve: any, reject: any) => { requests.push(q); return Promise.resolve(run(q)).then(resolve, reject); };
    return q;
  }
  return { from: query, rpc: query, requests };
}

describe("rollout pagination and operator state", () => {
  it("reads 2,001 rows and exact 2,000-row boundaries without dropping or repeating rows", async () => {
    for (const count of [0, 1000, 2000, 2001]) {
      const rows = Array.from({ length: count }, (_, id) => ({ id }));
      const query = vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }));
      expect(await fetchAllRows(query)).toEqual(rows);
      expect(query).toHaveBeenCalledTimes(Math.floor(count / 1000) + 1);
      query.mock.calls.forEach(([from, to], n) => expect([from, to]).toEqual([n * 1000, n * 1000 + 999]));
    }
  });

  it("never returns a partial successful result when a later page fails", async () => {
    const error = { message: "Database unavailable" };
    const query = async (from: number) => from === 0
      ? { data: Array(1000).fill({ id: 1 }), error: null }
      : { data: null, error };
    await expect(fetchAllRows(query)).rejects.toEqual(error);
    expect(await fetchAllRowsResult(query)).toEqual({ data: null, error });
  });

  it("the business selector loads 2,001 operators with stable ordering and preserves an override on the last page", async () => {
    const businesses = Array.from({ length: 2001 }, (_, n) => ({ id: String(n), name: "Operator " + n, timezone: "Africa/Johannesburg" }));
    const supabase = queryClient(q => {
      expect(q.calls.filter((c: any[]) => c[0] === "order").map((c: any[]) => c[1])).toEqual(["business_name", "id"]);
      const [, from, to] = q.calls.find((c: any[]) => c[0] === "range");
      const own = q.calls.find((c: any[]) => c[0] === "eq");
      return { data: (own ? businesses.filter(b => b.id === own[2]) : businesses).slice(from, to + 1), error: null };
    });
    const load = sourceFunction("components/AuthGate.tsx", "loadBusinessContext", {
      supabase, fetchAllRows, localStorage: { getItem: () => "2000" }, window: { location: { hostname: "test.invalid" } },
    });
    expect(await load("SUPER_ADMIN", "0")).toMatchObject({ businessId: "2000", operators: businesses.map(b => expect.objectContaining({ id: b.id })) });
    expect(supabase.requests).toHaveLength(3);
    const own = await load("MAIN_ADMIN", "0");
    expect(own.businessId).toBe("0");
    expect(own.operators).toHaveLength(1);
  });

  it("operator switches change the React subtree identity; settings refreshes retain it", () => {
    const { BusinessProvider } = sourceExports("components/BusinessContext.tsx", { react: { ...React, useEffect: vi.fn() }, "react/jsx-runtime": jsx, "@sentry/nextjs": { setTag: vi.fn() } }) as any;
    const value = { businessId: "operator-a", businessName: "A", role: "SUPER_ADMIN", timezone: "UTC", logoUrl: "" };
    const a = BusinessProvider({ value, children: "page" });
    const refreshed = BusinessProvider({ value: { ...value, businessName: "Renamed" }, children: "page" });
    const b = BusinessProvider({ value: { ...value, businessId: "operator-b" }, children: "page" });
    expect(a.key).toBe("operator-a");
    expect(refreshed.key).toBe(a.key);
    expect(b.key).toBe("operator-b");
  });

  it("an old settings refresh cannot switch back after the operator was changed", async () => {
    let resolve: (context: any) => void = () => {};
    const contextRequestRef = { current: 0 };
    const setBusinessId = vi.fn();
    const refresh = sourceFunction("components/AuthGate.tsx", "refreshBusiness", {
      businessId: "a", role: "SUPER_ADMIN", contextRequestRef, setBusinessId,
      loadBusinessContext: () => new Promise(done => { resolve = done; }),
    });
    const pending = refresh();
    contextRequestRef.current++; // switchOperator invalidates the old request
    resolve({ businessId: "a" });
    await pending;
    expect(setBusinessId).not.toHaveBeenCalled();
  });

  it("bookings load more/refresh covers the visible prefix above 1,000 without duplicates", async () => {
    const rows = Array.from({ length: 1203 }, (_, n) => ({ id: "booking-" + n, tours: [{ name: "Tour" }], slots: [{ id: "slot-" + n }] }));
    const supabase = queryClient(q => {
      if (q.table === "list_operator_bookings") {
        expect(q.args.p_business_id).toBe("a");
        expect(q.args.p_limit).toBeLessThanOrEqual(1000);
        return { data: rows.slice(q.args.p_offset, q.args.p_offset + q.args.p_limit), error: null };
      }
      const ids = q.calls.find((c: any[]) => c[0] === "in")[2];
      expect(ids.length).toBeLessThanOrEqual(200);
      if (q.table === "pending_reschedules") expect(q.calls).toContainEqual(["eq", "business_id", "a"]);
      return { data: [], error: null };
    });
    const state: any = {};
    const bindings = {
      supabase, fetchAllRows, businessId: "a", PAGE_SIZE: 50, loadRequestRef: { current: 0 },
      rangeStart: new Date("2026-09-01Z"), rangeEnd: new Date("2026-09-30Z"),
      setBookings: (value: any) => { state.bookings = value; },
      setHasMore: (value: any) => { state.hasMore = value; }, setLoading: vi.fn(), notify: vi.fn(),
    };
    const load = sourceFunction("app/bookings/page.tsx", "loadBookings", { ...bindings, page: 20 });
    await load();
    expect(state.bookings).toHaveLength(1050);
    expect(state.bookings[1049].id).toBe("booking-1049");
    expect(state.bookings[0].tours).toEqual({ name: "Tour" });
    expect(state.hasMore).toBe(true);
    await load();
    expect(state.bookings).toHaveLength(1050);
    expect(new Set(state.bookings.map((b: any) => b.id)).size).toBe(1050);
    await sourceFunction("app/bookings/page.tsx", "loadBookings", { ...bindings, page: 24 })();
    expect(state.bookings).toHaveLength(1203);
    expect(state.hasMore).toBe(false);
    expect(bindings.notify).not.toHaveBeenCalled();
  });
});

function reportLoader(run: (query: any) => any, filterBy = "created") {
  const supabase = queryClient(run);
  const state: any = {};
  const loadRequestRef = { current: 0 };
  const setters = Object.fromEntries(["Loading", "ReportError", "Bookings", "SignedInPeriod", "ReportTruncated"].map(name => ["set" + name, (value: any) => { state[name] = value; }]));
  const load = sourceFunction("app/reports/page.tsx", "loadReport", {
    supabase, loadRequestRef, ...setters, zonedToUtc,
    businessId: "a", startDate: "2026-09-01", endDate: "2026-09-30", activeTimezone: "Africa/Johannesburg", filterBy,
    addDaysStr: sourceFunction("app/reports/page.tsx", "addDaysStr", {}),
  });
  return { supabase, state, load, loadRequestRef };
}

describe("report data-loading regressions", () => {
  it.each(["slot", "created"])("%s-date reports paginate and apply tenant-local exclusive day boundaries on the server", async (filterBy) => {
    const rows = Array.from({ length: 2001 }, (_, id) => ({ id, tours: [{ name: "Tour" }], slots: [{ start_time: "2026-09-02T08:00:00Z" }] }));
    const { load, state, supabase } = reportLoader(q => {
      const range = q.calls.find((c: any[]) => c[0] === "range");
      return range ? { data: rows.slice(range[1], range[2] + 1), error: null } : { count: 77, error: null };
    }, filterBy);
    await load();
    expect(state.Bookings).toHaveLength(2001);
    expect(state.Bookings[0].tours).toEqual({ name: "Tour" });
    expect(state.SignedInPeriod).toBe(77);
    expect(state.ReportTruncated).toBe(false);
    expect(state.Loading).toBe(false);
    const field = filterBy === "slot" ? "slots.start_time" : "created_at";
    for (const q of supabase.requests.slice(0, 3)) {
      expect(q.calls).toContainEqual(["eq", "business_id", "a"]);
      expect(q.calls).toContainEqual(["gte", field, "2026-08-31T22:00:00.000Z"]);
      expect(q.calls).toContainEqual(["lt", field, "2026-09-30T22:00:00.000Z"]);
      if (filterBy === "slot") {
        expect(q.calls).toContainEqual(["eq", "slots.business_id", "a"]);
        expect(q.calls[0][1]).toContain("slots!inner(start_time)");
      }
    }
    expect(supabase.requests).toHaveLength(4); // no truncated intermediate slots lookup
  });

  it("a failed second page clears partial totals and surfaces a retry message", async () => {
    const { load, state } = reportLoader(q => q.calls.find((c: any[]) => c[0] === "range")[1] === 0
      ? { data: Array(1000).fill({ id: "a" }), error: null }
      : { data: null, error: { message: "Offline" } });
    await load();
    expect(state.Bookings).toEqual([]);
    expect(state.ReportError).toContain("Retry");
    expect(state.Loading).toBe(false);
  });

  it("an old report response cannot overwrite state after the filter changed", async () => {
    let finish: (result: any) => void = () => {};
    const { load, state, loadRequestRef } = reportLoader(() => new Promise(resolve => { finish = resolve; }));
    const pending = load();
    await Promise.resolve();
    loadRequestRef.current++;
    state.Bookings = [{ id: "new-filter-result" }];
    finish({ data: [{ id: "old-filter-result" }], error: null });
    await pending;
    expect(state.Bookings).toEqual([{ id: "new-filter-result" }]);
  });

  it.each(["Refund", "Invoice", "Voucher", "Settlement"])("the %s register exports all 2,001 rows, with bounded queries and server date filters", async (kind) => {
    const rows = Array.from({ length: 2001 }, (_, n) => ({
      id: "booking-" + n, code: "voucher-" + n, invoice_number: n + 1, created_at: "2026-09-02T00:00:00Z", refund_processed_at: "2026-09-03T00:00:00Z",
      redeemed_at: "2026-09-04T00:00:00Z", total_refunded: 50, total_captured: 100, total_amount: 100, value: 100, current_balance: 50,
      period_start: "2026-09-01", period_end: "2026-09-30", collector_business_id: "a", owed_business_id: "partner-" + n, amount_owed: 25,
    }));
    const supabase = queryClient(q => {
      if (q.table === "businesses") {
        const ids = q.calls.find((c: any[]) => c[0] === "in")[2];
        expect(ids.length).toBeLessThanOrEqual(200);
        return { data: ids.map((id: string) => ({ id, name: id })), error: null };
      }
      if (kind === "Settlement") {
        expect(q.calls).toContainEqual(["or", "collector_business_id.eq.a,owed_business_id.eq.a"]);
      } else {
        expect(q.calls).toContainEqual(["eq", "business_id", "a"]);
      }
      if (kind === "Refund") {
        expect(q.calls).toContainEqual(["or", "and(refund_processed_at.gte.2026-08-31T22:00:00.000Z,refund_processed_at.lt.2026-09-30T22:00:00.000Z),and(refund_processed_at.is.null,total_refunded.gt.0,cancelled_at.gte.2026-08-31T22:00:00.000Z,cancelled_at.lt.2026-09-30T22:00:00.000Z)"]);
      }
      const [, from, to] = q.calls.find((c: any[]) => c[0] === "range");
      return { data: rows.slice(from, to + 1), error: null };
    });
    const triggerDownload = vi.fn();
    const registerFailed = vi.fn();
    await sourceFunction("app/reports/page.tsx", "download" + kind + "Register", {
      supabase, fetchAllRowsResult, zonedToUtc, triggerDownload, registerFailed, setRegisterBusy: vi.fn(),
      startDate: "2026-09-01", endDate: "2026-09-30", activeTimezone: "Africa/Johannesburg", businessId: "a", csvPrefix: "operator-a",
      addDaysStr: sourceFunction("app/reports/page.tsx", "addDaysStr", {}),
      buildCSV: (_title: string, _headers: string[], data: any[]) => data,
      fmtDateTime: (date: string) => date, fmtDate: (date: string) => date, amountReceived, amountRefunded,
    })();
    expect(registerFailed).not.toHaveBeenCalled();
    expect(triggerDownload).toHaveBeenCalledOnce();
    const csv = triggerDownload.mock.calls[0][0];
    // Summary rows follow data; vouchers have separate sold/redeemed/open sections.
    const expected = kind === "Voucher" ? 6003 : 2001;
    expect(csv.slice(0, expected)).toHaveLength(expected);
    expect(csv[expected - 1].length).toBeGreaterThan(5);
    expect(supabase.requests.filter(q => q.table !== "businesses")).toHaveLength(kind === "Voucher" ? 9 : 3);
  });

  it("an export started on the old operator cannot download after its page unmounts", () => {
    const createElement = vi.fn();
    sourceFunction("app/reports/page.tsx", "triggerDownload", {
      mountedRef: { current: false }, document: { createElement },
    })("private operator A data", "operator-a.csv");
    expect(createElement).not.toHaveBeenCalled();
  });
});
