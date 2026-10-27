import {test,expect,type Page} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";
import {DEFAULT_DASHBOARD_LAYOUT} from "../../app/lib/dashboard-layout";
const evidence="docs/operator-usability/screenshots";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
async function setup(page:Page){
 await page.clock.install({time:new Date("2026-10-15T05:00:00Z")});
 await page.addInitScript(()=>{
 const exp=4102444800;const encode=(v:object)=>btoa(JSON.stringify(v)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
 const user={id:"10000000-0000-4000-8000-000000000110",email:"operator@example.invalid",aud:"authenticated",role:"authenticated"};
 localStorage.setItem("sb-127-auth-token",JSON.stringify({access_token:encode({alg:"HS256"})+"."+encode({...user,sub:user.id,exp})+".synthetic",refresh_token:"synthetic",expires_at:exp,expires_in:3600,token_type:"bearer",user}));
 localStorage.setItem("ck_admin_timezone","Africa/Johannesburg");localStorage.setItem("ck_welcome_done","1");localStorage.setItem("ck_admin_settings_perms","{}");});
 await page.routeWebSocket(/realtime/,()=>{});
 await page.route("**/*",route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=="127.0.0.1"||!["3160","3161"].includes(url.port))return route.abort();
  if(url.pathname==="/api/dashboard-layout"&&route.request().method()==="GET")return route.fulfill({json:{layout:DEFAULT_DASHBOARD_LAYOUT,revision:0}});
  if(url.pathname.startsWith("/api/"))return route.fulfill({status:403,contentType:"application/json",body:'{"error":"Synthetic preview refuses operational API writes"}'});
  return route.continue();
 });
 await page.request.post("http://127.0.0.1:3161/__fixture/reset");mkdirSync(evidence,{recursive:true});
}
async function choose(page:Page,label:string,option:string){
 await page.getByRole('combobox',{name:label,exact:true}).click();
 await page.getByRole('listbox',{name:label,exact:true}).getByRole('option',{name:option,exact:true}).click();
}
const state=(page:Page)=>page.request.get("http://127.0.0.1:3161/__fixture/state").then(r=>r.json());
async function noExternalEffects(page:Page){const s=await state(page);expect(s.providerCalls).toBe(0);return s;}
async function screenshot(page:Page,name:string){await page.screenshot({path:`${evidence}/${name}.png`,fullPage:true,animations:"disabled"});}

test.describe('booking dropdown placement',()=>{
 test.use({hasTouch:true});
 for(const viewport of [{width:320,height:844},{width:390,height:844},{width:844,height:390},{width:1280,height:900}])test(`booking menus stay beside their fields at ${viewport.width}px`,async({page})=>{
  await setup(page);await page.setViewportSize(viewport);
  await page.request.post('http://127.0.0.1:3161/__fixture/questions',{data:[{key:'equipment',label:'Equipment choice',type:'select',options:['Standard','Small']}]});
  await page.route('**/rest/v1/tours?*',async route=>{
   const response=await route.fetch(),rows=await response.json();
   await route.fulfill({response,json:[...rows,...Array.from({length:12},(_,i)=>({...rows[0],id:id(300+i),name:`Long activity name for mobile selection ${i+1}`}))]});
  });
  await page.goto(`/new-booking?date=2026-10-15&tour=${id(3)}&slot=${id(4)}`);
  await expect(page.getByRole('combobox',{name:'Departure time',exact:true})).toHaveAttribute('data-value',id(4));
  for(const label of ['Activity','Departure time','Equipment choice','Payment action','Payment due within']){
   const field=page.getByRole('combobox',{name:label,exact:true});
   await field.scrollIntoViewIfNeeded();await field.tap();
   const menu=page.getByRole('listbox',{name:label,exact:true});await expect(menu).toBeVisible();
   const bounds=await menu.boundingBox(),anchor=await field.boundingBox();expect(bounds).not.toBeNull();expect(anchor).not.toBeNull();
   expect(bounds!.x).toBeGreaterThanOrEqual(7);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width-7);
   expect(bounds!.y).toBeGreaterThanOrEqual(7);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height-7);
   expect(Math.min(Math.abs(bounds!.y-anchor!.y-anchor!.height),Math.abs(bounds!.y+bounds!.height-anchor!.y))).toBeLessThanOrEqual(8);
   expect(bounds!.width).toBeGreaterThanOrEqual(Math.min(288,viewport.width-16));
   const option=menu.getByRole('option').first();expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(48);
   expect(await option.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
   await page.screenshot({path:`/private/tmp/booking-menu-${viewport.width}-${label.replaceAll(' ','-')}.png`});
   if(label==='Activity'){
    expect(await menu.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
    expect(bounds!.height).toBeGreaterThanOrEqual(viewport.height < 600 ? 140 : 240);
    if(viewport.width===390){
     const touch=await page.context().newCDPSession(page),x=bounds!.x+bounds!.width/2,y=bounds!.y+bounds!.height-30;
     await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
     for(let step=1;step<=8;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*20}]});
     await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     await expect.poll(()=>menu.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);await touch.detach();
    }
    await menu.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(menu.getByRole('option').last()).toBeInViewport();
    await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(field).toBeFocused();
   }else{
    await option.tap();await expect(menu).toHaveCount(0);
   }
  }
  const due=page.getByRole('combobox',{name:'Payment due within',exact:true});
  await due.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Enter');
  await expect(due).toHaveAttribute('data-value','168');await expect(due).toBeFocused();
  await due.tap();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(due).toHaveAttribute('data-value','6');
  await due.tap();await page.keyboard.press('Tab');await expect(page.getByRole('listbox')).toHaveCount(0);
  const activity=page.getByRole('combobox',{name:'Activity',exact:true});await activity.tap();
  const menu=page.getByRole('listbox',{name:'Activity',exact:true});
  await page.evaluate(()=>window.scrollBy(0,40));await expect(menu).toBeVisible();
  const moved=await menu.boundingBox(),anchor=await activity.boundingBox();
  expect(Math.min(Math.abs(moved!.y-anchor!.y-anchor!.height),Math.abs(moved!.y+moved!.height-anchor!.y))).toBeLessThanOrEqual(8);
  await page.getByRole('heading',{name:'1. Departure and party',exact:true}).tap();await expect(menu).toHaveCount(0);
  await choose(page,'Activity','Coastal walk');await page.getByLabel('Adults',{exact:true}).fill('50');
  await expect(page.getByRole('status').filter({hasText:'Insufficient capacity'})).toHaveText('Insufficient capacity');
  await expect(activity).toHaveAttribute('data-value',id(8));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect((await noExternalEffects(page)).writes).toEqual([]);
 });
});

for(const width of [390,1280])test(`arrival guidance resolves the actual blocker and opens partial counts at ${width}px`,async({page})=>{
 await setup(page);await page.setViewportSize({width,height:900});await page.goto('/');
 const roll=page.getByRole('region',{name:'Roll Call',exact:true});
 await expect(page.getByRole('heading',{name:'Booking value',exact:true})).toBeVisible();
 for(const [booking,label,section] of [[id(21),'Review booking status','summary'],[id(22),'Review payment','payment'],[id(23),'Resolve waiver','waiver']]){
  const action=roll.getByRole('link',{name:label,exact:true}).and(roll.locator(`a[href^="/bookings/${booking}?"]`));
  await expect(action).toHaveAttribute('href',new RegExp(`#${section}$`));
 }
 await expect(roll).not.toContainText('A checkbox marks the whole group as arrived.');
 await roll.getByRole('heading',{name:'Roll Call',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`/private/tmp/impeccable-clarify-arrival-guidance-${width}.png`,animations:'disabled'});
 await roll.screenshot({path:`/private/tmp/impeccable-clarify-arrivals-${width}.png`});
 await page.goto(`/simple/check-ins?date=2026-10-15&slot=${id(4)}`);
 await expect(page).toHaveURL(`/simple/check-ins?date=2026-10-15&slot=${id(4)}`);
 const partial=page.locator('li.sv-check-in').filter({hasText:'Partial Example'});
 await expect(partial.getByRole('button',{name:'Save arrivals',exact:true})).toBeDisabled();
 await page.goto('/simple?date=2026-10-15');
 const departure=page.locator(`article.sv-departure[data-slot-id="${id(4)}"]`);
 const paymentAction=departure.getByRole('link',{name:'Review payment',exact:true}).and(departure.locator(`a[href^="/bookings/${id(22)}?"]`));
 await expect(paymentAction).toHaveAttribute('href',new RegExp(`/bookings/${id(22)}.*#payment$`));
 expect(await departure.getByRole('link',{name:/^Edit arrivals for /}).first().getAttribute('href')).toContain(`/simple/check-ins?date=2026-10-15&slot=${id(4)}#arrived-`);
 await expect(departure.getByRole('link',{name:'Add walk-in',exact:true})).toHaveAttribute('href',new RegExp(`slot=${id(4)}`));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 if(width===1280){
  await page.evaluate(()=>{document.documentElement.style.zoom='2';});
  await expect(paymentAction).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await departure.getByRole('link',{name:/^Edit arrivals for /}).first().scrollIntoViewIfNeeded();
  await page.screenshot({path:'/private/tmp/impeccable-clarify-zoom-200.png'});
 }
 expect((await noExternalEffects(page)).writes).toEqual([]);
});

for (const width of [320, 768, 844, 1280]) test(`departure comparison preserves selection without horizontal scrolling at ${width}px`, async ({page}) => {
 await setup(page);await page.setViewportSize({width,height:width===844?390:900});
 await page.goto(`/simple/new-booking?date=2026-10-15&tour=${id(3)}&slot=${id(4)}&returnTo=%2Fsimple`);
 const time=page.getByLabel('Departure time',{exact:true});await expect(time).toHaveAttribute('data-value',id(4));
 await page.screenshot({path:`/private/tmp/impeccable-adapt-booking-${width}.png`,fullPage:true});
 if(width===320)await expect(page.getByLabel('Departure date',{exact:true})).toBeVisible();
 const comparison=page.locator('details').filter({has:page.getByText('Compare nearby dates',{exact:true})});
 await expect(comparison).not.toHaveAttribute('open','');
 await comparison.locator('summary').focus();await page.keyboard.press('Enter');
 const tomorrow=comparison.getByRole('button',{name:'2026-10-16 10:00, 17 places available',exact:true});
 await tomorrow.click();await expect(time).toHaveAttribute('data-value',id(5));await expect(tomorrow).toHaveAttribute('aria-pressed','true');
 await expect(comparison.getByRole('button',{pressed:true})).toHaveCount(1);
 const contrast=await tomorrow.evaluate(el=>{
  const ctx=document.createElement('canvas').getContext('2d')!;
  const luminance=(color:string)=>{
   ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
   const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});
   return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
  };
  const style=getComputedStyle(el),text=luminance(style.color),background=luminance(style.backgroundColor);
  return (Math.max(text,background)+0.05)/(Math.min(text,background)+0.05);
 });
 expect(contrast).toBeGreaterThanOrEqual(4.5);
 expect(await comparison.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 expect(await tomorrow.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await comparison.screenshot({path:`/private/tmp/impeccable-adapt-comparison-${width}.png`});
 await page.getByLabel('Adults',{exact:true}).fill('50');await expect(tomorrow).toBeDisabled();
 expect((await noExternalEffects(page)).writes).toEqual([]);
});

test('phone roll call puts booked guests before payment follow-up and empty departures',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});await page.goto('/simple');
 const departures=page.locator('.sv-departure-list');await expect(departures).toContainText('Alex Example');
 for(const name of ['Payment recovery','Departures without bookings']){
  const secondary=page.getByRole('region',{name,exact:true});
  expect(await departures.evaluate((el,selector)=>Boolean(el.compareDocumentPosition(document.querySelector(selector)!)&Node.DOCUMENT_POSITION_FOLLOWING),name==='Payment recovery'?'[aria-label="Payment recovery"]':'[aria-label="Departures without bookings"]')).toBe(true);
  await expect(secondary).toBeAttached();
 }
 await page.screenshot({path:'/private/tmp/impeccable-adapt-roll-call-390.png',fullPage:true});
 expect((await noExternalEffects(page)).writes).toEqual([]);
});

test("Full and Simple share exact records and keep simultaneous activities separate across a browser timezone",async({page})=>{
 await setup(page);await page.goto("/");
 const manifest=page.getByRole("region",{name:"Manifest",exact:true});await expect(manifest).toBeVisible();
 for(const guests of [10,4])await expect(manifest.getByText(String(guests),{exact:true}).or(manifest.getByText(`${guests} guests`,{exact:true})).filter({visible:true})).toBeVisible();
 await expect(manifest).not.toContainText("Totals");
 await expect(manifest.getByRole("link",{name:"Add Booking",exact:true})).toHaveCount(0);
 await expect(page.getByRole("region",{name:"Roll Call",exact:true}).getByText("Departure 1 of 2",{exact:true})).toBeVisible();
 await expect(page.getByText(/Africa\/Johannesburg/).first()).toBeVisible();await screenshot(page,"full-daily");
 await page.goto("/simple");await expect(page.getByLabel("Selected date")).toHaveValue("2026-10-15");
 await expect(page.getByLabel("Overview for Thursday, 15 October").or(page.locator('.sv-day-summary'))).toContainText("14");
 await expect(page.getByRole("link",{name:"Alex Example",exact:true})).toHaveCount(1);
 await expect(page.getByRole("link",{name:"Cancelled Example",exact:true})).toHaveCount(0);
 await expect(page.getByRole("region",{name:"Departures without bookings"})).toContainText("16:00");
 await screenshot(page,"simple-daily");
 await page.getByRole("link",{name:"Alex Example",exact:true}).scrollIntoViewIfNeeded();await screenshot(page,"simple-manifest");
 await page.getByLabel("Selected date").fill("2026-10-16");
 await expect(page.getByRole("link",{name:"Alex Example",exact:true})).toHaveCount(1);
 await expect(page.getByRole("link",{name:"Partial Example",exact:true})).toHaveCount(0);
 expect((await noExternalEffects(page)).writes).toEqual([]);
});

test("missing waiver resolves the exact booking and returns to the same date and slot without sending",async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.goto(`/simple/check-ins?date=2026-10-15&slot=${id(4)}`);
 const guest=page.locator("li.sv-check-in").filter({hasText:"Waiver Example"});
 await expect(guest.getByRole("button",{name:"Save arrivals",exact:true})).toBeDisabled();
 await guest.getByRole("link",{name:"Resolve this booking’s waiver"}).click();
 await expect(page).toHaveURL(new RegExp(`/bookings/${id(23)}.*#waiver`));
 await expect(page.getByRole("region",{name:"Waiver & Intake"})).toBeFocused();
 await expect(page.getByText("This is the booking-level waiver record.",{exact:false})).toBeVisible();
 await screenshot(page,"waiver-resolution-mobile");
 await page.getByRole("button",{name:"Back",exact:true}).click();
 await expect(page).toHaveURL(`/simple/check-ins?date=2026-10-15&slot=${id(4)}`);
 expect((await noExternalEffects(page)).writes).toEqual([]);
});

test("walk-in review is non-mutating, child and safety details survive editing, create opens the booking in Bookings",async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.goto(`/simple/new-booking?date=2026-10-15&tour=${id(3)}&slot=${id(4)}&returnTo=${encodeURIComponent('/simple?date=2026-10-15')}`);
 await expect(page.getByLabel("Activity",{exact:true})).toHaveAttribute('data-value',id(3));await expect(page.getByLabel("Departure time",{exact:true})).toHaveAttribute('data-value',id(4));
 await page.getByLabel("Adults",{exact:true}).fill("2");await page.getByLabel("Children",{exact:true}).fill("1");
 await page.getByLabel("Full Name",{exact:false}).fill("Walk-in Example");await page.getByLabel("Mobile Number",{exact:false}).fill("+27825550123");await page.getByLabel("Email",{exact:false}).fill("walkin@example.invalid");
 await page.getByLabel("Required safety information",{exact:false}).fill("Synthetic safety answer");
 await choose(page,"Payment action","Confirm booking, money still due");
 await page.getByRole("button",{name:"Review booking",exact:true}).click();
 const review=page.getByRole("region",{name:"Review booking",exact:true});await expect(review).toContainText("2 adults, 1 child");await expect(review).toContainText("R300,00 due");
 expect((await noExternalEffects(page)).writes).toEqual([]);
 await review.getByRole("checkbox").uncheck();await screenshot(page,"walk-in-review-mobile");
 await page.getByRole("button",{name:/Create Booking/}).scrollIntoViewIfNeeded();await screenshot(page,"walk-in-confirm-mobile");
 await review.getByRole("button",{name:"Edit booking",exact:true}).click();await expect(page.getByLabel("Full Name",{exact:false})).toHaveValue("Walk-in Example");
 await page.getByRole("button",{name:"Review booking",exact:true}).click();
 await page.getByRole("button",{name:/Create Booking/}).dblclick();
 await expect(page).toHaveURL(/\/bookings\?date=2026-10-15&booking=/);
 const s=await noExternalEffects(page);expect(s.writes).toHaveLength(1);expect(s.writes[0].body.p_payload).toMatchObject({adults:2,children:1,send_notifications:false,expected_total:300,status:"CONFIRMED"});await screenshot(page,"walk-in-bookings-mobile");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test("unavailable and empty data stay distinct; keyboard help exposes status meanings",async({page})=>{
 await setup(page);await page.request.post("http://127.0.0.1:3161/__fixture/unavailable");await page.goto("/simple");
 await expect(page.getByRole("alert").filter({hasText:"Day unavailable"})).toContainText("Day unavailable");await expect(page.getByText("No bookings today",{exact:true})).toHaveCount(0);await expect(page.getByRole("checkbox")).toHaveCount(0);await screenshot(page,"day-unavailable");
 await page.goto("/");await expect(page.getByRole("alert").filter({hasText:"Counts and actions are hidden"})).toContainText("Counts and actions are hidden");await expect(page.getByRole("region",{name:"Manifest",exact:true})).toHaveCount(0);
 await page.request.post("http://127.0.0.1:3161/__fixture/reset");await page.request.post("http://127.0.0.1:3161/__fixture/empty");await page.goto("/simple");await expect(page.getByText("No bookings today",{exact:true})).toBeVisible();
 await page.goto("/simple/help");const glossary=page.locator("summary");await glossary.focus();await page.keyboard.press("Enter");await expect(page.locator("details")).not.toHaveAttribute("open","");await page.keyboard.press("Enter");await expect(page.getByText("A reservation has been confirmed. Money may still be due.",{exact:true})).toBeVisible();
 writeFileSync(`${evidence}/help-aria.txt`,await page.locator("main").last().ariaSnapshot());
 expect((await noExternalEffects(page)).writes).toEqual([]);
});

for(const status of ['PENDING','HELD','CONFIRMED','PAID'])test(`manual ${status} booking requires email before review`,async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.goto(`/simple/new-booking?date=2026-10-15&tour=${id(3)}&slot=${id(4)}&returnTo=%2Fsimple`);
 await expect(page.getByLabel('Departure time',{exact:true})).toHaveAttribute('data-value',id(4));
 await page.getByLabel('Adults',{exact:true}).fill('1');
 await page.getByLabel('Full Name',{exact:false}).fill('Email Required Example');
 await page.getByLabel('Required safety information',{exact:false}).fill('Synthetic safety answer');
 await choose(page,'Payment action',({PENDING:'Request payment',HELD:'Hold places, no immediate message',CONFIRMED:'Confirm booking, money still due',PAID:'Payment received'})[status]);
 const email=page.getByLabel('Email',{exact:false});await expect(email).toHaveAttribute('aria-required','true');
 await email.fill('');await page.getByRole('button',{name:'Review booking',exact:true}).click();
 await expect(email).toHaveAttribute('aria-invalid','true');await expect(page.getByRole('region',{name:'Review booking',exact:true})).toHaveCount(0);
 await expect(page.getByText('Enter a valid email address for payment notices and the waiver.')).toBeVisible();
 expect((await noExternalEffects(page)).writes).toEqual([]);
 await email.fill('guest@example.invalid');await page.getByRole('button',{name:'Review booking',exact:true}).click();
 await expect(page.getByRole('region',{name:'Review booking',exact:true})).toBeVisible();
 expect((await noExternalEffects(page)).writes).toEqual([]);
});

test("cancel and browser back preserve unsaved details within the same authenticated tab",async({page})=>{
 await setup(page);await page.goto(`/simple/new-booking?date=2026-10-15&tour=${id(3)}&slot=${id(4)}&returnTo=%2Fsimple`);
 await expect(page.getByLabel("Activity",{exact:true})).toHaveAttribute('data-value',id(3));
 await page.getByLabel("Full Name",{exact:false}).fill("Unsaved Example");await page.getByLabel("Required safety information",{exact:false}).fill("Synthetic safety answer");
 await page.getByRole("button",{name:"Cancel",exact:true}).click();await expect(page).toHaveURL("/simple");await page.goBack();
 await expect(page.getByLabel("Full Name",{exact:false})).toHaveValue("Unsaved Example");await expect(page.getByLabel("Required safety information",{exact:false})).toHaveValue("Synthetic safety answer");
 expect((await noExternalEffects(page)).writes).toEqual([]);
});

test("configured participant questions require a separate answer for every guest",async({page})=>{
 await setup(page);
 await page.route('**/rest/v1/businesses?*',async route=>{
  const response=await route.fetch();const original=await response.json();
  const questions=[{key:'safety',label:'Required safety information',required:true,type:'text'}, {key:'equipment',label:'Equipment choice',required:true,type:'select',scope:'per_participant',options:['Standard','Small']}];
  const change=(row:any)=>({...row,booking_custom_fields:questions});
  await route.fulfill({response,json:Array.isArray(original)?original.map(change):change(original)});
 });
 await page.goto(`/simple/new-booking?date=2026-10-15&tour=${id(3)}&slot=${id(4)}&returnTo=%2Fsimple`);
 await expect(page.getByLabel('Departure time',{exact:true})).toHaveAttribute('data-value',id(4));
 await page.getByLabel('Adults',{exact:true}).fill('1');await page.getByLabel('Children',{exact:true}).fill('1');
 await page.getByLabel('Full Name',{exact:false}).fill('Party Example');await page.getByLabel('Mobile Number',{exact:false}).fill('+27825550123');await page.getByLabel('Email',{exact:false}).fill('party@example.invalid');
 await page.getByLabel('Required safety information',{exact:false}).fill('Synthetic answer');
 await choose(page,'Guest 1: Equipment choice','Standard');
 await page.getByRole('button',{name:'Review booking',exact:true}).click();
 await expect(page.getByRole('region',{name:'Review booking',exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Guest 2: Equipment choice',{exact:false})).toHaveAttribute('aria-invalid','true');
 await choose(page,'Guest 2: Equipment choice','Small');
 await page.getByRole('button',{name:'Review booking',exact:true}).click();
 const review=page.getByRole('region',{name:'Review booking',exact:true});await expect(review).toBeVisible();await review.getByRole('checkbox').uncheck();
 await page.getByRole('button',{name:/Create Booking/}).click();await expect(page).toHaveURL(/\/bookings\?date=[0-9-]+&booking=/);
 const s=await noExternalEffects(page);expect(s.writes).toHaveLength(1);expect(s.writes[0].body.p_payload.custom_fields.equipment).toEqual(['Standard','Small']);
});

test("missing configured price is unavailable rather than a free booking",async({page})=>{
 await setup(page);await page.route('**/rest/v1/tours?*',async route=>{const response=await route.fetch();const rows=await response.json();await route.fulfill({response,json:rows.map((row:any)=>({...row,base_price_per_person:null}))});});
 await page.goto(`/simple/new-booking?date=2026-10-15&tour=${id(3)}&slot=${id(4)}&returnTo=%2Fsimple`);
 await expect(page.getByLabel('Departure time',{exact:true})).toHaveAttribute('data-value',id(4));
 await expect(page.getByRole('alert').filter({hasText:'no valid configured price'})).toBeVisible();await expect(page.getByRole('button',{name:'Review booking',exact:true})).toBeDisabled();
 expect((await noExternalEffects(page)).writes).toEqual([]);
});

for(const width of [390,1280])test(`admin extra pax accepts a bespoke date time quantity and total at ${width}px`,async({page})=>{
 await setup(page);await page.setViewportSize({width,height:900});await page.goto('/new-booking');
 await expect(page.getByLabel('Activity',{exact:true})).toHaveAttribute('data-value',id(3));await choose(page,'Activity','Extra pax');
 await expect(page.getByLabel('Adults',{exact:true})).not.toHaveAttribute('max','50');
 await page.getByLabel('Adults',{exact:true}).fill('120');await page.getByLabel('Children',{exact:true}).fill('5');
 await page.getByLabel('Departure date',{exact:true}).fill('2020-01-02');await page.getByLabel('Departure time',{exact:true}).fill('00:15');
 await page.getByLabel('Total price (R)',{exact:true}).fill('4321.09');
 await page.getByLabel('Full Name',{exact:false}).fill('Bespoke Group');await page.getByLabel('Email',{exact:false}).fill('group@example.invalid');await page.getByLabel('Required safety information',{exact:false}).fill('Synthetic answer');
 await expect(page.getByLabel('Payment action',{exact:true})).toHaveAttribute('data-value','CONFIRMED');
 await expect(page.getByText('Insufficient capacity',{exact:true}).filter({visible:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Review booking',exact:true}).click();
 const review=page.getByRole('region',{name:'Review booking',exact:true});await expect(review).toContainText('125 guests');await expect(review).toContainText('00:15');await expect(review).toContainText(/4\s?321[,.]09/);
 expect((await noExternalEffects(page)).writes).toHaveLength(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`/private/tmp/extra-pax-${width}.png`,fullPage:true});
 if(await page.getByRole('region',{name:'Review booking',exact:true}).getByRole('checkbox').count())await page.getByRole('region',{name:'Review booking',exact:true}).getByRole('checkbox').uncheck();await page.getByRole('button',{name:/Create Booking/}).dblclick();await expect(page).toHaveURL(/\/bookings\?date=[0-9-]+&booking=/);
 const s=await noExternalEffects(page);expect(s.writes).toHaveLength(1);expect(s.writes[0].body.p_payload).toMatchObject({departure_override:true,departure_local:'2020-01-02T00:15:00',adults:120,children:5,override_total:4321.09,expected_total:4321.09,status:'CONFIRMED'});
 await page.goto('/simple?date=2020-01-02');await expect(page.getByRole('link',{name:'Bespoke Group',exact:true})).toBeVisible();await expect(page.locator('article').filter({hasText:'Bespoke Group'})).toContainText('Extra pax');
});

test('admin overrides an existing activity and must enter a price, including explicit zero',async({page})=>{
 await setup(page);await page.goto('/new-booking');await page.getByLabel('Override departure and capacity',{exact:true}).check();
 await page.getByLabel('Adults',{exact:true}).fill('80');await page.getByLabel('Departure date',{exact:true}).fill('2099-10-15');await page.getByLabel('Departure time',{exact:true}).fill('23:45');
 await page.getByLabel('Full Name',{exact:false}).fill('Complimentary Group');await page.getByLabel('Email',{exact:false}).fill('group@example.invalid');await page.getByLabel('Required safety information',{exact:false}).fill('Synthetic answer');
 await page.getByRole('button',{name:'Review booking',exact:true}).click();await expect(page.getByLabel('Total price (R)',{exact:true})).toHaveAttribute('aria-invalid','true');
 await expect(page.getByRole('region',{name:'Review booking',exact:true})).toHaveCount(0);expect((await noExternalEffects(page)).writes).toHaveLength(0);
 await page.getByLabel('Total price (R)',{exact:true}).fill('0');await choose(page,'Payment action','Payment received');
 await page.getByRole('button',{name:'Review booking',exact:true}).click();await expect(page.getByRole('region',{name:'Review booking',exact:true})).toContainText('Harbour paddle');
 await page.getByRole('button',{name:/Create Booking/}).click();await expect(page).toHaveURL(/\/bookings\?date=[0-9-]+&booking=/);
 expect((await noExternalEffects(page)).writes[0].body.p_payload).toMatchObject({tour_id:id(3),departure_override:true,expected_total:0,adults:80,status:'PAID'});
});

test('large groups can answer required questions for guests after the first 50',async({page})=>{
 await setup(page);await page.request.post('http://127.0.0.1:3161/__fixture/questions',{data:[{key:'medical',label:'Medical note',scope:'participant',required:true,type:'text'}]});await page.goto('/new-booking');
 await expect(page.getByLabel('Activity',{exact:true})).toHaveAttribute('data-value',id(3));await choose(page,'Activity','Extra pax');await page.getByLabel('Adults',{exact:true}).fill('51');
 await page.getByLabel('Departure date',{exact:true}).fill('2099-10-15');await page.getByLabel('Departure time',{exact:true}).fill('12:15');await page.getByLabel('Total price (R)',{exact:true}).fill('50');await page.getByLabel('Full Name',{exact:false}).fill('Large Group');await page.getByLabel('Email',{exact:false}).fill('group@example.invalid');
 await page.getByRole('button',{name:'Next guests',exact:true}).click();await expect(page.getByLabel('Guest 51: Medical note',{exact:false})).toBeVisible();await page.getByLabel('Guest 51: Medical note',{exact:false}).fill('None');
 await page.getByRole('button',{name:'Previous guests',exact:true}).click();for(let guest=1;guest<=50;guest++)await page.getByLabel(`Guest ${guest}: Medical note`,{exact:false}).fill('None');
 await page.getByRole('button',{name:'Review booking',exact:true}).click();await expect(page.getByRole('region',{name:'Review booking',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Create Booking/}).click();await expect(page).toHaveURL(/\/bookings\?date=[0-9-]+&booking=/);expect((await noExternalEffects(page)).writes[0].body.p_payload.custom_fields.medical).toHaveLength(51);
});

for (const width of [320, 768, 1440]) test(`polish: welcome tour and selected departures remain usable at ${width}px`, async ({page}) => {
 await setup(page); await page.setViewportSize({width,height:900}); await page.goto('/');
 await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
 const manifest=page.getByRole('region',{name:'Manifest',exact:true});
 const departure=manifest.getByRole('button',{name:/Coastal walk/}).filter({visible:true});
 await departure.click(); await expect(departure).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('region',{name:'Roll Call',exact:true})).toContainText('Coastal walk');
 await manifest.screenshot({path:`/private/tmp/polish-manifest-${width}.png`});
 const trigger=page.getByRole('link',{name:'Add Booking',exact:true}).first(); await trigger.focus();
 await page.evaluate(()=>window.dispatchEvent(new Event('ck-welcome-tour-open')));
 const dialog=page.getByRole('dialog',{name:'Welcome tour'}); await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Start the tour'}).click();
 for (const button of await dialog.getByRole('button').all()) {
  const box=await button.boundingBox(); expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x+box!.width).toBeLessThanOrEqual(width);
 }
 await dialog.screenshot({path:`/private/tmp/polish-onboarding-${width}.png`});
 await dialog.getByRole('button',{name:'Close for now'}).focus(); await page.keyboard.press('Shift+Tab');
 expect(await page.evaluate(()=>document.activeElement===document.body||!!document.activeElement?.closest('dialog'))).toBe(true);
 await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await noExternalEffects(page)).writes).toEqual([]);
});

test('polish: email preferences stays readable with a long customer address', async ({page}) => {
 const source=(await import('node:fs')).readFileSync('supabase/functions/marketing-unsubscribe/index.ts','utf8');
 const body='<h2>Unsubscribe</h2>'+source.split('<h2>Unsubscribe</h2>')[1].split('`, 200);')[0];
 const html=source.split('const html = `')[1].split('`;')[0].replace('${body}',body).replace('${safeFirstName}','Alex').replace('${safeEmail}','a.long.customer.email.address@example.invalid').replace('${safeToken}','synthetic');
 for(const width of [320,768,1280]){
  await page.setViewportSize({width,height:900}); await page.setContent(html);
  await expect(page.getByLabel('Reason (optional):')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByLabel('Reason (optional):').focus(); await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'Unsubscribe',exact:true})).toBeFocused();
  await page.screenshot({path:`/private/tmp/polish-unsubscribe-${width}.png`});
 }
});
