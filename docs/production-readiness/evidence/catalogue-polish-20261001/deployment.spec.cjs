const {test,expect}=require('/Users/gideonlangenhoven/dev/capekayak/node_modules/@playwright/test');
const fs=require('node:fs');
const out=__dirname;
const live=process.env.CATALOGUE_LIVE==='1';
const kayak='44ff11ab-c697-47de-9227-0ffa51db127c';
const claire='af17838c-fdd6-4b84-97c0-1cea39db7c0a';
const tour='96e07644-315b-4e96-8f36-bb070b665cf8';
const home=live?'/':`/?business_id=${kayak}`;
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('cookie-consent-accepted','true'));
  await page.route('**/*',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort());
});
async function geometry(page){
  const result=await page.locator('.catalogue-page').evaluate(root=>({overflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth,clipped:[...root.querySelectorAll('h3,.catalogue-price,.catalogue-description,.catalogue-action')].filter(el=>el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1).map(el=>el.textContent),targets:[...root.querySelectorAll('.catalogue-action')].map(el=>el.getBoundingClientRect().height),ratios:[...root.querySelectorAll('.catalogue-photo')].map(el=>{const r=el.getBoundingClientRect();return r.width/r.height})}));
  expect(result.overflow).toBeLessThanOrEqual(1);expect(result.clipped).toEqual([]);expect(result.targets.every(x=>x>=44)).toBe(true);
  for(const ratio of result.ratios)expect(ratio).toBeCloseTo(page.viewportSize().width>=768?2:16/9,1);
  result.phoneLauncher=await page.evaluate(()=>{
    if(innerWidth>=480)return null;
    const launcher=document.querySelector('[aria-label="Open chat"]');if(!launcher)return null;
    const box=launcher.getBoundingClientRect();const header=document.querySelector('.catalogue-header').getBoundingClientRect();
    return {width:box.width,height:box.height,withinHeader:box.top>=header.top&&box.bottom<=header.bottom,collisions:[...document.querySelectorAll('.catalogue-brand,.catalogue-nav a,.catalogue-card h3,.catalogue-price,.catalogue-action')].filter(el=>{const r=el.getBoundingClientRect();const visibleTop=el.closest('.catalogue-card')?Math.max(r.top,header.bottom):r.top;return box.left<r.right&&box.right>r.left&&box.top<r.bottom&&box.bottom>visibleTop}).map(el=>el.textContent)};
  });
  if(result.phoneLauncher){expect(result.phoneLauncher.width).toBeGreaterThanOrEqual(44);expect(result.phoneLauncher.height).toBeGreaterThanOrEqual(44);expect(result.phoneLauncher.withinHeader).toBe(true);expect(result.phoneLauncher.collisions).toEqual([]);}
  return result;
}
test('catalogue: authoritative prices, three current tours, photographs and 320px layout',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let authoritative=[];
  page.on('response',async response=>{if(response.url().includes('/rest/v1/tours?')&&response.ok()){try{authoritative=await response.json();}catch{}}});
  const response=await page.goto(home);expect(response.status()).toBe(200);
  await expect(page.locator('.catalogue-card')).toHaveCount(3);
  await expect.poll(()=>authoritative.length).toBeGreaterThan(0);
  for(const card of await page.locator('.catalogue-card').all()){
    const name=await card.locator('h3').innerText();const record=authoritative.find(t=>t.name===name);expect(record).toBeTruthy();
    await expect(card.locator('.catalogue-price')).toHaveText(`R${record.base_price_per_person}per person`);
    await expect(card.getByRole('link')).toHaveCount(1);await expect(card.getByRole('link')).toHaveAttribute('href','/book?tour='+record.id);
    await card.locator('img').scrollIntoViewIfNeeded();
  }
  await expect.poll(()=>page.locator('.catalogue-photo img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
  await page.evaluate(()=>document.fonts.ready);
  for(const label of ['Gift Voucher','My Bookings'])await expect(page.locator('.catalogue-header').getByRole('link',{name:label,exact:true})).toBeVisible();
  const initial=await geometry(page);await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:`${out}/${live?'live':'candidate'}-${info.project.name}.png`,fullPage:true});
  await page.setViewportSize({width:320,height:900});const narrow=await geometry(page);
  await page.screenshot({path:`${out}/${live?'live':'candidate'}-320-${info.project.name}.png`,fullPage:true});
  await page.addStyleTag({content:'html { font-size: 200%; }'});await page.evaluate(()=>scrollTo(0,0));await geometry(page);
  await expect(page.getByRole('button',{name:'Open chat',exact:true})).toBeVisible();
  await page.screenshot({path:`${out}/${live?'live':'candidate'}-text-200-${info.project.name}.png`});
  await page.getByRole('button',{name:'Open chat',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Close chat',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await geometry(page);
  expect(errors).toEqual([]);
  fs.writeFileSync(`${out}/${live?'live':'candidate'}-geometry-${info.project.name}.json`,JSON.stringify({initial,narrow,tours:authoritative.map(({id,name,base_price_per_person})=>({id,name,base_price_per_person})),pageErrors:errors},null,2));
});
test('navigation: keyboard focus, whole-card action, existing destinations and calendar deep link',async({page,browserName})=>{
  await page.goto(home);await expect(page.locator('.catalogue-card .catalogue-action')).toHaveCount(3);
  for(const selector of ['.catalogue-brand','.catalogue-nav a[href="/voucher"]','.catalogue-nav a[href="/my-bookings"]','.catalogue-card .catalogue-action']){
    await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab');await expect(page.locator(selector).first()).toBeFocused();
    expect(await page.locator(selector).first().evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
  }
  const href=await page.locator('.catalogue-action').first().getAttribute('href');await page.keyboard.press('Enter');await expect(page).toHaveURL(new RegExp(href.replace('?', '\\?')));
  await page.goto(home);await expect(page.locator('.catalogue-card .catalogue-action')).toHaveCount(3);await page.locator('.catalogue-card').nth(1).click();await expect(page).toHaveURL(/\/book\?tour=/);
  await page.goto(home);await page.locator('.catalogue-nav a[href="/voucher"]').click();await expect(page).toHaveURL(/\/voucher$/);
  await page.goto(home);await page.locator('.catalogue-nav a[href="/my-bookings"]').click();await expect(page).toHaveURL(/\/my-bookings$/);
  await page.goto(`/book?tour=${tour}${live?'':`&business_id=${kayak}`}`);
  const calendar=page.locator('[data-shot="calendar"]');await expect(calendar).toHaveClass(/guest-calendar/);
  await page.locator('[data-shot="calendar-day"]:enabled').first().click();
  const departure=page.locator('button[data-slot-id]').first();await departure.click();const slot=await departure.getAttribute('data-slot-id');const date=await departure.getAttribute('data-slot-date');expect(date).toBeTruthy();
  await page.getByRole('button',{name:/Continue to details/i}).filter({visible:true}).first().click();await expect(page.locator('#book-name')).toBeVisible();
  await page.getByRole('button',{name:'Back to calendar'}).click();await expect(page.locator(`[data-slot-id="${slot}"]`)).toHaveAttribute('aria-pressed','true');
  await page.goto(`/book?tour=${tour}&slot=${slot}&date=${encodeURIComponent(date)}${live?'':`&business_id=${kayak}`}`);await expect(page.locator(`[data-slot-id="${slot}"]`)).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
test('another tenant retains its saved brand, five tours and booking destinations',async({page})=>{
  await page.goto(live?'https://claires-hiking.booking.bookingtours.co.za/':`/?business_id=${claire}`);
  await expect(page.locator('.catalogue-card')).toHaveCount(5);
  await expect(page.locator('.catalogue-brand')).toContainText(/Claire/i);
  await geometry(page);
  for(const card of await page.locator('.catalogue-card').all())await expect(card.getByRole('link')).toHaveAttribute('href',/\/book\?tour=/);
});
