import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase/functions/_shared/tenant.ts', () => ({
  createServiceClient: () => { throw new Error('Real service client forbidden in runtime tests'); },
}));

import { handleAvailabilitySyncRequest, handleSupplierRequest } from '../../supabase/functions/_shared/ota-runtime';
import { viatorNotifyEvents } from '../../supabase/functions/_shared/viator';

type Result = { data: unknown; error: null | { message: string } };
function database(...responses: Result[]) {
  const queries: { table: string; filters: unknown[][] }[] = [];
  const from = vi.fn((table: string) => {
    const entry = { table, filters: [] as unknown[][] };
    queries.push(entry);
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => { entry.filters.push(args); return query; },
      is: (...args: unknown[]) => { entry.filters.push(args); return query; },
      order: () => query,
      range: () => query,
      maybeSingle: () => query,
      then: (resolve: (result: Result) => unknown) => {
        const result = responses.shift();
        if (!result) throw new Error('Unexpected database query: ' + table);
        return Promise.resolve(result).then(resolve);
      },
    };
    return query;
  });
  return { from, queries, rpc: vi.fn(async () => ({ data: null, error: null })) };
}
const result = (data: unknown): Result => ({ data, error: null });
const basic = 'Basic ' + btoa('fixture:secret');
const env = (name: string) => ({
  GYG_SUPPLIER_USERNAME: 'fixture', GYG_SUPPLIER_PASSWORD: 'secret', SUPABASE_SERVICE_ROLE_KEY: 'worker-token',
} as Record<string, string>)[name];
const request = (path: string, data: unknown, authorization = basic) => new Request('https://fixture.invalid' + path, {
  method: 'POST', headers: { authorization }, body: JSON.stringify({ data }),
});

describe('supplier runtime routing and notification failures', () => {
  it('rejects incoming GYG bearer auth before querying or constructing a service client', async () => {
    const db = database();
    const response = await handleSupplierRequest(request('/1/reserve/', { productId: 'P' }, 'Bearer token'), 'GETYOURGUIDE', db, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ errorCode: 'AUTHORIZATION_FAILURE' });
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('rejects unknown routes and malformed JSON before resolving an operator', async () => {
    const db = database();
    const unknown = await handleSupplierRequest(request('/1/unknown/', { productId: 'P' }), 'GETYOURGUIDE', db, env);
    expect(await unknown.json()).toMatchObject({ errorCode: 'VALIDATION_FAILURE' });
    const malformed = await handleSupplierRequest(new Request('https://fixture.invalid/1/reserve/', {
      method: 'POST', headers: { authorization: basic }, body: '{',
    }), 'GETYOURGUIDE', db, env);
    expect(await malformed.json()).toMatchObject({ errorCode: 'VALIDATION_FAILURE' });
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each([
    ['/1/book/', { reservationReference: 'missing', gygBookingReference: 'GYG', productId: 'P' }, 'INVALID_RESERVATION', 'ota_reservations'],
    ['/1/cancel-reservation/', { reservationReference: 'missing', gygBookingReference: 'GYG' }, 'INVALID_RESERVATION', 'ota_reservations'],
    ['/1/cancel-booking/', { bookingReference: 'missing', gygBookingReference: 'GYG', productId: 'P' }, 'INVALID_BOOKING', 'bookings'],
    ['/1/reserve/', { productId: 'P', gygBookingReference: 'GYG' }, 'INVALID_PRODUCT', 'ota_product_mappings'],
  ])('returns the documented reference error for %s', async (path, data, code, table) => {
    const db = database(result([]));
    const response = await handleSupplierRequest(request(path, data), 'GETYOURGUIDE', db, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ errorCode: code });
    expect(db.queries[0].table).toBe(table);
    if (table === 'ota_product_mappings') {
      expect(db.queries[0].filters).toContainEqual(['enabled', true]);
    } else {
      expect(db.queries[0].filters).toContainEqual([table === 'bookings' ? 'ota_environment' : 'environment', 'SANDBOX']);
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('rejects a supplier product mapped to multiple businesses', async () => {
    const db = database(result([{ business_id: 'tenant-a' }, { business_id: 'tenant-b' }]));
    const response = await handleSupplierRequest(request('/1/reserve/', { productId: 'P' }), 'GETYOURGUIDE', db, env);
    expect(await response.json()).toMatchObject({ errorCode: 'INVALID_PRODUCT' });
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('resolves the reservation owner rather than a supplied tenant hint and rejects a foreign GYG reference', async () => {
    const db = database(
      result([{ business_id: 'tenant-b' }]),
      result({ enabled: true, test_mode: true }),
      result({ details: { provider_reference: 'GYG-B' } }),
    );
    const response = await handleSupplierRequest(request('/1/cancel-reservation/?b=tenant-a', {
      reservationReference: 'reservation-b', gygBookingReference: 'GYG-A',
    }), 'GETYOURGUIDE', db, env);
    expect(await response.json()).toMatchObject({ errorCode: 'INVALID_RESERVATION' });
    expect(db.queries.slice(1).every(q => q.filters.some(f => f[0] === 'business_id' && f[1] === 'tenant-b'))).toBe(true);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('requires the sync service token before database or network access', async () => {
    const db = database();
    const fetcher = vi.fn(async () => { throw new Error('Network forbidden'); });
    const response = await handleAvailabilitySyncRequest(request('/sync', {}, 'Bearer wrong'), 'VIATOR', db, env, fetcher);
    expect(response.status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['https://viator.com.attacker.invalid', 'http://api.viator.com', 'https://user:secret@api.viator.com', 'https://api.viator.com:8443'])('rejects untrusted notification host %s before credentials or network access', async host => {
    const db = database(result([{ business_id: 'tenant-a', config_json: { notification_base_url: host } }]));
    const fetcher = vi.fn(async () => { throw new Error('Network forbidden'); });
    const response = await handleAvailabilitySyncRequest(request('/sync', {}, 'Bearer worker-token'), 'VIATOR', db, env, fetcher);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: 'Notification URL must be an HTTPS provider-owned host' });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('propagates a sync database scan failure without sending a notification', async () => {
    const db = database({ data: null, error: { message: 'injected read failure' } });
    const fetcher = vi.fn(async () => { throw new Error('Network forbidden'); });
    const response = await handleAvailabilitySyncRequest(request('/sync', {}, 'Bearer worker-token'), 'GETYOURGUIDE', db, env, fetcher);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a Viator 207 with a rejected option instead of acknowledging the whole batch', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [
      { productOptionId: 'A', status: 200 },
      { productOptionId: 'B', status: 422, error: 'INVALID_PRODUCT_OPTION' },
    ] }), { status: 207 }));
    await expect(viatorNotifyEvents('https://api.viator.com', 'fixture-key', {
      supplierId: 1004, productOptionIds: ['A', 'B'], updateType: ['AVAILABILITY'], startDate: '2030-01-01', endDate: '2030-01-01',
    }, fetcher)).rejects.toThrow('partially rejected');
  });
});
