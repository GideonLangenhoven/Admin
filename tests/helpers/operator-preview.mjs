import {createServer} from 'node:http';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
const root=resolve('.'),preview=mkdtempSync('/private/tmp/bookingtours-operator-preview-');
const port=Number(process.env.OPERATOR_PREVIEW_PORT||3160),fixturePort=port+1;
for(const file of ['app','components','supabase/functions/_shared','public','tailwind.config.js','postcss.config.js','tsconfig.json','package.json']){
 const target=join(preview,file);mkdirSync(resolve(target,'..'),{recursive:true});cpSync(join(root,file),target,{recursive:true});
}
symlinkSync(join(root,'node_modules'),join(preview,'node_modules'),'dir');
if(process.env.OPERATOR_PREVIEW_LAYOUT_EDITOR==='1')writeFileSync(join(preview,'components/DashboardPreviewContext.tsx'),readFileSync(join(root,'tests/fixtures/dashboard-preview-context.tsx'),'utf8').replace('../../components/BusinessContext','./BusinessContext'));
writeFileSync(join(preview,'next.config.ts'),'export default {devIndicators:false,webpack(config){config.cache=false;return config;}};');
// No AuthGate, production environment, telemetry setup, secrets or external providers are loaded.
writeFileSync(join(preview,'app/layout.tsx'),`import './globals.css';import {BusinessProvider} from '../components/${process.env.OPERATOR_PREVIEW_LAYOUT_EDITOR==='1'?'DashboardPreviewContext':'BusinessContext'}';import AppShell from '../components/AppShell';
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body style={{fontFamily:'system-ui,sans-serif'}}><BusinessProvider value={{businessId:'10000000-0000-4000-8000-000000000001',businessName:'Example Tours (synthetic)',staffName:'Practice Operator',role:'ADMIN',logoUrl:'',timezone:'Africa/Johannesburg',subscriptionStatus:'ACTIVE',readOnly:false}}><AppShell nav={[{href:'/',label:'Dashboard',icon:'LayoutDashboard'},{href:'/simple',label:'Simple View',icon:'Check'},{href:'/bookings',label:'Bookings',icon:'ClipboardList'},{href:'/new-booking',label:'Add Booking',icon:'PlusSquare'},{href:'/slots',label:'Slots',icon:'CalendarRange'},{href:'/inbox',label:'Inbox',icon:'MessageSquareText'}]}>{children}</AppShell></BusinessProvider></body></html>}`);
const fixture=JSON.parse(readFileSync(join(root,'tests/fixtures/operator-day.json'),'utf8'));
let state;const reset=()=>state={bookings:structuredClone(fixture.bookings),slots:structuredClone(fixture.slots),questions:[{key:"safety",label:"Required safety information",required:true,type:"text"}],writes:[],providerCalls:0,unavailable:false};reset();
const futureSlots=(start,end,tour)=>state.slots.filter(s=>s.start_time>=start&&s.start_time<end&&(!tour||s.tour_id===tour));
const manifest=(start,end)=>state.bookings.filter(b=>!['CANCELLED','EXPIRED'].includes(b.status)&&b.slots.start_time>=start&&b.slots.start_time<end);
const server=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','GET,HEAD,POST,PATCH,DELETE,OPTIONS');res.setHeader('Content-Type','application/json');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const url=new URL(req.url,`http://127.0.0.1:${fixturePort}`);let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw||'{}');
 const send=(value,status=200)=>{res.writeHead(status);res.end(JSON.stringify(value));};
 if(url.pathname==='/__fixture/reset'&&req.method==='POST'){reset();send({});return;}
 if(url.pathname==='/__fixture/questions'&&req.method==='POST'){state.questions=body;send({});return;}
 if(url.pathname==='/__fixture/state'){send(state);return;}
 if(url.pathname==='/__fixture/unavailable'&&req.method==='POST'){state.unavailable=true;send({});return;}
 if(url.pathname==='/__fixture/empty'&&req.method==='POST'){state.bookings=[];send({});return;}
 if(url.pathname.startsWith('/functions/')){state.providerCalls++;send({error:'External effects disabled in synthetic fixture'},403);return;}
 if(url.pathname.startsWith('/rest/v1/rpc/')){
  const name=url.pathname.split('/').pop();
  if(state.unavailable&&['operator_departure_manifest','get_operator_dashboard','list_available_slots'].includes(name)){send({message:'Synthetic unavailable'},503);return;}
  if(name==='operator_departure_manifest'){send(manifest(body.p_range_start,body.p_range_end));return;}
  if(name==='get_operator_dashboard'){
   send({business_id:fixture.business_id,today_manifest:manifest(body.p_today_start,body.p_tomorrow_start),tomorrow_manifest:manifest(body.p_tomorrow_start,body.p_day_after),refund_count:0,refund_total:0,inbox_count:0,photos_outstanding:0,revenue:{today:0,week:0,month:0,series:[]},weather_widget_locations:[]});return;
  }
  if(name==='list_available_slots'){send(futureSlots(body.p_range_start,body.p_range_end,body.p_tour_id).map(s=>({...s,tour_name:s.tours.name,base_price_per_person:100,available_capacity:s.capacity_total-s.booked-s.held})));return;}
  if(name==='create_operator_booking'){
   state.writes.push({name,body});const prior=state.bookings.find(b=>b.id===body.p_request_id);
   if(prior){send({...prior,ok:true,replay:true});return;}
   const p=body.p_payload;let slot=state.slots.find(s=>s.id===p.slot_id);
   if(p.departure_override){const time=new Date(p.departure_local+'+02:00').toISOString(),tour=p.tour_id==='00000000-0000-0000-0000-000000000001'?{id:'10000000-0000-4000-8000-000000000099',name:'Extra pax'}:{id:p.tour_id,name:state.slots.find(s=>s.tour_id===p.tour_id)?.tours.name||'Harbour paddle'};
    slot=state.slots.find(s=>s.tour_id===tour.id&&s.start_time===time);
    if(!slot){slot={id:body.p_request_id,business_id:fixture.business_id,tour_id:tour.id,start_time:time,status:'CLOSED',capacity_total:p.adults+p.children,booked:0,held:0,tours:tour};state.slots.push(slot);}
   }
   const b={id:body.p_request_id,business_id:fixture.business_id,slot_id:slot.id,qty:p.adults+p.children,status:p.status,total_amount:p.expected_total,total_captured:p.status==='PAID'?p.expected_total:0,customer_name:p.customer_name,email:p.email,phone:p.phone,waiver_status:'PENDING',arrived_count:0,checked_in:false,slots:{id:slot.id,start_time:slot.start_time},start_time:slot.start_time,tours:slot.tours,invoice_number:'SYNTHETIC-001',custom_fields:p.custom_fields};state.bookings.push(b);send({...b,ok:true});return;
  }
  if(name==='approve_account_arrival'){state.writes.push({name,body});const booking=state.bookings.find(b=>b.id===body.p_booking_id);if(booking)booking.unpaid_arrival_approved=body.p_decision==='approve';send({ok:true});return;}
  if(name==='list_operator_bookings'){send(state.bookings);return;}
  if(name==='operator_booking_history'){send([]);return;}
  send([]);return;
 }
 const table=url.pathname.split('/').pop();let rows=[];
 if(table==='businesses')rows=[{id:fixture.business_id,name:'Example Tours (synthetic)',currency:'ZAR',timezone:'Africa/Johannesburg',booking_custom_fields:state.questions,meeting_point:'Synthetic harbour'}];
 if(table==='tours')rows=[{id:'10000000-0000-4000-8000-000000000003',business_id:fixture.business_id,name:'Harbour paddle',base_price_per_person:100},{id:'10000000-0000-4000-8000-000000000008',business_id:fixture.business_id,name:'Coastal walk',base_price_per_person:100}];
 if(table==='slots'){
  const gtes=url.searchParams.getAll('start_time');let start=gtes.find(v=>v.startsWith('gte.'))?.slice(4)||'',end=gtes.find(v=>v.startsWith('lt.'))?.slice(3)||'z';rows=futureSlots(start,end);
 }
 if(table==='bookings'){
  rows=url.searchParams.has('payment_failed_at')?[]:state.bookings;
 }
 if(table==='payment_recovery_bookings'){
  rows=state.bookings.filter(b=>b.status!=='DRAFT').map(b=>({...b,created_at:b.created_at||'2026-10-15T05:00:00Z',amount_due:['CANCELLED','EXPIRED'].includes(b.status)?0:Math.max(0,Number(b.total_amount)-Number(b.total_captured||(['PAID','COMPLETED'].includes(b.status)?b.total_amount:0)))}));
  if(url.searchParams.get('amount_due')==='gt.0')rows=rows.filter(b=>b.amount_due>0);
 }
 if(table==='add_ons')rows=[{id:'10000000-0000-4000-8000-000000000090',name:'Dry bag',price:25,description:'Synthetic extra'}];
 const idFilter=url.searchParams.get('id');if(idFilter?.startsWith('eq.'))rows=rows.filter(r=>r.id===idFilter.slice(3));
 if(req.method!=='GET'&&req.method!=='HEAD'){state.writes.push({table,body});send({message:'Direct writes disabled in synthetic fixture'},403);return;}
 if(req.headers.prefer?.includes('count=exact'))res.setHeader('Content-Range',`0-${Math.max(0,rows.length-1)}/${rows.length}`);
 send(req.headers.accept?.includes('vnd.pgrst.object')?rows[0]||null:rows);
});
server.listen(fixturePort,'127.0.0.1');
const env=Object.fromEntries(['PATH','USER','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${fixturePort}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-only',NEXT_TELEMETRY_DISABLED:'1'});
const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','--webpack','-H','127.0.0.1','-p',String(port)],{cwd:preview,env,stdio:'inherit'});
writeFileSync('/private/tmp/bookingtours-operator-preview-path',preview);
console.log(`Synthetic operator demo: http://127.0.0.1:${port}/simple; fixture: http://127.0.0.1:${fixturePort}; isolated source:`,preview);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill(signal);server.close();});child.on('exit',code=>{server.close();process.exit(code||0);});
