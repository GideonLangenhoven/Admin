const { createServer } = require('node:http');

const businessId = '10000000-0000-4000-8000-000000000001';
const tourId = '20000000-0000-4000-8000-000000000001';
const otherTourId = '20000000-0000-4000-8000-000000000002';
const fixtureNow = '2026-10-01T08:00:00Z';
const theme = {
  id: businessId, business_name: 'Trail Adventures', timezone: 'America/New_York', subscription_status: 'ACTIVE', booking_custom_fields: [],
  subdomain: 'guest-fixture', hero_eyebrow: 'Find your next adventure', hero_title: 'Fresh air. A different perspective.',
  hero_subtitle: 'Explore our guided adventures and choose a departure that fits your day.',
  color_main: '#32684c', color_secondary: '#687444', color_cta: '#32684c', color_bg: '#f4f5ef', color_nav: '#f4f5ef',
  refund_policy_tiers: [{ hours_before: 48, refund_percent: 75 }, { hours_before: 6, refund_percent: 25 }, { hours_before: 0, refund_percent: 0 }],
  refund_policy_text: 'Cancellations at least 48 hours before departure receive a 75% cash refund. From 6 to under 48 hours, 25%. Under 6 hours, no cash refund. Voucher payments return as voucher credit.',
  booking_site_url: 'http://127.0.0.1:3116',
};
const tours = [
  { id: tourId, name: 'Mountain views and a guided walk along the quiet coastal trails', description: 'A guided walk along the coast with views of the mountains.', meeting_point: 'Visitor centre entrance', base_price_per_person: 600 },
  { id: otherTourId, name: 'Forest trail', description: 'Follow the forest paths with your guide.', base_price_per_person: 450 },
  { id: '20000000-0000-4000-8000-000000000003', name: 'Coastal paddle', description: 'Explore the coastline from the water.', base_price_per_person: 500 },
].map((tour, sort_order) => ({ ...tour, business_id: businessId, duration_minutes: 120, image_url: '/stock/hike.jpg', active: true, hidden: false, sort_order }));
const slots = [
  { id: '30000000-0000-4000-8000-000000000001', tour_id: tourId, start_time: '2026-10-03T14:00:00Z', price_per_person_override: 625 },
  { id: '30000000-0000-4000-8000-000000000002', tour_id: tourId, start_time: '2026-10-04T17:00:00Z' },
  { id: '30000000-0000-4000-8000-000000000003', tour_id: otherTourId, start_time: '2026-11-04T14:00:00Z' },
].map(slot => ({ ...slot, business_id: businessId, status: 'OPEN', capacity_total: 10, booked: 2, held: 1 }));

module.exports = { businessId, tourId, otherTourId, fixtureNow, theme, tours, slots };

if (require.main === module) {
  let state = { theme, tours, slots };
  const bookings = new Map();
  createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1:3117');
    let body = ''; for await (const part of req) body += part;
    if (url.pathname === '/__fixture/reset') {
      const overrides = body ? JSON.parse(body) : {};
      state = { theme: { ...theme, ...overrides.theme }, tours: overrides.tours || tours, slots: overrides.slots || slots, checkoutErrorOnce: overrides.checkoutErrorOnce === true };
      bookings.clear(); res.end('{}'); return;
    }
    if (url.pathname === '/__fixture/state') { res.end(JSON.stringify({ ...state, bookings: [...bookings.values()] })); return; }
    if (url.pathname === '/functions/v1/create-checkout') {
      const request = JSON.parse(body);
      const booking = bookings.get(request.booking_id);
      if (state.checkoutErrorOnce && booking) {
        state.checkoutErrorOnce = false;
        booking.status = 'HELD';
        state.slots = state.slots.map(slot => slot.id === booking.slot_id ? { ...slot, held: slot.held + booking.qty } : slot);
        res.writeHead(503); res.end(JSON.stringify({ reason: 'Fixture payment provider unavailable. Please retry.' })); return;
      }
      res.end(JSON.stringify({ redirectUrl: 'http://127.0.0.1:3116/fixture-payment', amount: booking?.total_amount, expires_at: '2026-10-01T08:15:00Z' })); return;
    }
    const table = url.pathname.split('/').pop();
    let data = table === 'businesses' ? [state.theme] : table === 'tours' ? state.tours : table === 'slots' ? state.slots : table === 'bookings' ? [...bookings.values()] : [];
    for (const field of ['id', 'tour_id', 'status', 'active']) {
      const filter = url.searchParams.get(field);
      if (filter?.startsWith('eq.')) data = data.filter(row => String(row[field]) === filter.slice(3));
    }
    if (table === 'slots') {
      if (url.searchParams.has('last_minute_at')) data = [];
      const from = url.searchParams.getAll('start_time').find(value => /^(gt|gte)\./.test(value));
      const to = url.searchParams.getAll('start_time').find(value => /^(lt|lte)\./.test(value));
      if (from) data = data.filter(row => Date.parse(row.start_time) > Date.parse(from.slice(from.indexOf('.') + 1)));
      if (to) data = data.filter(row => Date.parse(row.start_time) < Date.parse(to.slice(to.indexOf('.') + 1)));
    }
    if (table === 'bookings' && req.method === 'POST') { const booking = JSON.parse(body); bookings.set(booking.id, booking); data = [booking]; }
    if (req.headers.prefer?.includes('count=exact')) res.setHeader('Content-Range', `0-${Math.max(0, data.length - 1)}/${data.length}`);
    res.end(JSON.stringify(req.headers.accept?.includes('vnd.pgrst.object') ? data[0] || null : data));
  }).listen(3117, '127.0.0.1', () => console.log('Booking guest fixture listening on 3117'));
}
