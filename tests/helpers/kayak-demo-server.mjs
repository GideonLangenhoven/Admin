import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

export const kayak = '44ff11ab-c697-47de-9227-0ffa51db127c';
export const tours = [
  { id: '96e07644-315b-4e96-8f36-bb070b665cf8', name: 'Morning Kayak', base_price_per_person: 600, default_capacity: 20, image: '1790663949767.jpeg', description: 'Start the day on the water. A two-hour morning paddle with coastal views and time to enjoy Cape Town from a different perspective. Choose a departure below and make the morning yours.' },
  { id: '33910bd3-6826-4ee4-9dcc-4fcfcaf9097b', name: 'Sunset Paddle', base_price_per_person: 500, default_capacity: 10, image: '1790664015501.jpg', description: 'Trade the afternoon rush for an evening on the water. This two-hour paddle follows the coast as the light softens, with the city and mountains as your backdrop. Sunset timing and routes depend on conditions.' },
  { id: '8dbdf290-7a45-4bd9-a07e-77f0176b41ed', name: 'Midday Hike', base_price_per_person: 700, default_capacity: 10, image: '1790664062648.jpeg', description: 'Take the adventure onto land with a two-hour Table Mountain hike. Enjoy the mountain scenery and a fresh perspective on Cape Town. Bring comfortable walking shoes, water and a sun hat.' },
].map((t,index) => ({ ...t, business_id: kayak, image_url: `/__kayak-demo/${t.image}`, duration_minutes: 120, sort_order: index, active: true, hidden: false }));

const theme = {
  id: kayak, business_name: 'Kayak', subdomain: 'kayak', timezone: 'Africa/Johannesburg',
  subscription_status: 'ACTIVE', yoco_test_mode: true, logo_url: null,
  hero_eyebrow: null, hero_title: null, hero_subtitle: null, hero_image: null,
  color_main: '#1f7a8c', color_secondary: '#022b3a', color_cta: '#1f7a8c', color_bg: '#e1e5f2', color_nav: '#ffffff',
  footer_line_one: null, footer_line_two: null,
};
const slots = Array.from({length:31},(_,day) => tours.map((t,index) => {
  const date = new Date(Date.now() + (day+1)*86400000);
  date.setUTCHours([6,15,10][index],30,0,0);
  return { id: `00000000-0000-4000-8000-${String(day*3+index+1).padStart(12,'0')}`, business_id: kayak, tour_id:t.id, start_time:date.toISOString(), status:'OPEN', capacity_total:t.default_capacity, booked:2, held:0 };
})).flat();
const bookings = new Map();
let checkoutRequests = 0;
const cache = '/private/tmp/capekayak-kayak-demo-photos';
mkdirSync(cache,{recursive:true});
// Only public operator photos are downloaded. All database/payment APIs below
// are local doubles; this server never loads credentials or contacts providers.
for (const t of tours) {
  if(existsSync(`${cache}/${t.image}`)) continue;
  const response = await fetch(`https://ukdsrndqhsatjkmxijuj.supabase.co/storage/v1/object/public/email-images/${kayak}/tours/${t.image}`,{signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error('Public photo download failed: '+response.status);
  writeFileSync(`${cache}/${t.image}`,Buffer.from(await response.arrayBuffer()));
}

createServer(async(req,res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');
  if(req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
  const url = new URL(req.url,'http://127.0.0.1:3107');
  if(url.pathname.startsWith('/photos/')) {
    const name = url.pathname.split('/').pop();
    if(!tours.some(t=>t.image===name)) {res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','image/jpeg');res.end(readFileSync(`${cache}/${name}`));return;
  }
  let body=''; for await (const part of req) body+=part;
  res.setHeader('Content-Type','application/json');
  if(url.pathname==='/__fixture/state') {res.end(JSON.stringify({bookings:[...bookings.values()],checkoutRequests}));return;}
  if(url.pathname==='/functions/v1/create-checkout') {
    checkoutRequests++;
    const request=JSON.parse(body);
    const booking=bookings.get(request.booking_id);
    if(!booking || booking.waiver_token!==request.booking_token) {res.writeHead(400);res.end('{}');return;}
    res.end(JSON.stringify({redirectUrl:'http://127.0.0.1:3106/fixture-payment',amount:booking.total_amount,expires_at:new Date(Date.now()+900000).toISOString()}));return;
  }
  const table=url.pathname.split('/').pop();
  let data=[];
  if(table==='businesses') data=[theme];
  if(table==='tours') data=tours.filter(t=>!url.searchParams.get('id') || url.searchParams.get('id')==='eq.'+t.id);
  if(table==='slots') data=url.searchParams.has('last_minute_at')?[]:slots.filter(s=>!url.searchParams.get('tour_id') || url.searchParams.get('tour_id')==='eq.'+s.tour_id);
  if(table==='bookings' && req.method==='POST') {const b=JSON.parse(body);bookings.set(b.id,b);data=[b];}
  if(table==='bookings' && req.method==='GET' && url.searchParams.get('id')) data=[bookings.get(url.searchParams.get('id').slice(3))].filter(Boolean);
  if(req.headers.prefer?.includes('count=exact')) res.setHeader('Content-Range',`0-${Math.max(data.length-1,0)}/${data.length}`);
  res.end(JSON.stringify(req.headers.accept?.includes('vnd.pgrst.object')?(data[0]||null):data));
}).listen(3107,'127.0.0.1',()=>console.log('Isolated Kayak demo fixture listening on 3107'));
