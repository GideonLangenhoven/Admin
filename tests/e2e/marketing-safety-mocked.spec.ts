import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const evidence="docs/marketing/screenshots";
const fixtureOrigin="http://127.0.0.1:"+(process.env.MARKETING_FIXTURE_PORT||3157);
test.beforeEach(async({page,request})=>{
 await request.post(fixtureOrigin+"/__fixture/reset");
 await page.route("**/api/marketing/setup", route => route.fulfill({json:{email_service_configured:true,email_feedback_configured:false,operator_status:"policy_approval_pending",welcome_back_available:false}}));
 await page.route("**/*",route=>{
   const url=new URL(route.request().url());
   return ["127.0.0.1","localhost"].includes(url.hostname)?route.fallback():route.abort();
 });
});
test.afterAll(async({request}) => { await request.post(fixtureOrigin+"/__fixture/reset"); });
test("marketing shows plain-language tasks and useful next actions without writing data",async({page,request})=>{
 mkdirSync(evidence,{recursive:true});await page.goto("/marketing");
 await expect(page.getByText('Active Contacts',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Email your customers'})).toHaveCount(0);
 await expect(page.getByText('0 contacts have agreed to marketing emails')).toHaveCount(0);
 const setup=page.getByRole('region',{name:'Email sending setup'});
 await expect(setup.getByRole('link',{name:'Email BookingTours'})).toHaveAttribute('href',/^mailto:support@bookingtours\.co\.za/);
 await expect(setup.getByText('BookingTours: connect bounced-email and spam reports.')).toBeVisible();
 await expect(setup.getByText('BookingTours: enable marketing emails for this operator.')).toBeVisible();
 await expect(setup.getByRole('link',{name:'Review contacts'})).toHaveAttribute('href','/marketing/contacts');
 await expect(page.getByRole('heading',{name:'Ask for reviews',exact:true})).toHaveCount(0);
 expect((await (await request.get(fixtureOrigin+'/__fixture/state')).json()).rpcCalls).not.toContain('marketing_goal_audiences');
 for(const text of ['Unknown evidence:','goal prerequisites','Booking attribution','Start with a useful follow-up'])await expect(page.getByText(text,{exact:false})).toHaveCount(0);
 await page.screenshot({path:`${evidence}/audience-desktop.png`,fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`${evidence}/review-mobile.png`,fullPage:true,animations:'disabled'});
 const state=await(await request.get(fixtureOrigin+'/__fixture/state')).json();expect(state.mutations).toEqual([]);expect(state.providerCalls).toBe(0);
});
test("a completed setup does not show the old blanket warning",async({page})=>{
 await page.route("**/api/marketing/setup", route=>route.fulfill({json:{email_service_configured:true,email_feedback_configured:true,operator_status:"eligible",welcome_back_available:true}}));
 await page.goto('/marketing');
 await expect(page.getByText('Active Contacts',{exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Email sending setup'})).toHaveCount(0);
});
test("a failed status check offers retry without claiming setup is incomplete",async({page})=>{
 await page.route("**/api/marketing/setup", route=>route.fulfill({status:503,json:{error:'Unavailable'}}));
 await page.goto('/marketing');
 const setup=page.getByRole('region',{name:'Email sending setup'});
 await expect(setup.getByRole('alert')).toHaveText('Email setup could not be checked.');
 await expect(setup.getByRole('link',{name:'Email BookingTours'})).toHaveCount(0);
 await page.route("**/api/marketing/setup", route=>route.fulfill({json:{email_service_configured:true,email_feedback_configured:true,operator_status:"eligible",welcome_back_available:false}}));
 await setup.getByRole('button',{name:'Check again'}).click();
 await expect(setup.getByText('Welcome-back emails unavailable',{exact:true})).toBeVisible();
 await expect(setup.getByText('BookingTours: finish automatic welcome-back emails.')).toBeVisible();
 await expect(setup.getByText('BookingTours: enable marketing emails for this operator.')).toHaveCount(0);
});
test("opening and navigating a new builder does not create a server draft and retains edits",async({page,request})=>{
 await page.goto("/marketing/automations/new");
 await expect(page.getByText("Unsaved draft. Choose Save to keep it.",{exact:false})).toBeVisible();
 const name=page.locator('input').first();
 await name.fill("Synthetic untouched draft");
 await page.getByRole("button",{name:"Back to automations"}).click();
 await page.getByRole("button",{name:/New Automation/i}).click();
 await expect(page.locator('input').first()).toHaveValue("Synthetic untouched draft");
 await page.screenshot({path:`${evidence}/unsaved-builder.png`,fullPage:true,animations:"disabled"});
 const state=await(await request.get(fixtureOrigin+"/__fixture/state")).json();expect(state.mutations).toEqual([]);
});
test("overview no longer loads the removed contact-permission summary",async({page,request})=>{
 await request.post(fixtureOrigin+"/__fixture/audience-error");
 await page.goto("/marketing");
 await expect(page.getByText('Active Contacts',{exact:true})).toBeVisible();
 await expect(page.getByText("Contact permissions could not be loaded.")).toHaveCount(0);
 const state=await(await request.get(fixtureOrigin+'/__fixture/state')).json();
 expect(state.rpcCalls).not.toContain('marketing_audience_summary');
});
test("opening a suggested recipe previews its executable contract without writing a draft",async({page,request})=>{
 await page.goto("/marketing/automations");
 const suggestions=page.getByRole("region",{name:"Suggested email sequences"});
 await expect(suggestions.getByRole("button",{name:"Preview sequence:",exact:false})).toHaveCount(3);
 await expect(suggestions.getByRole("link",{name:"View vouchers",exact:true})).toHaveAttribute("href","/vouchers");
 await expect(suggestions.getByText("Automatic reminders are not available yet.")).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`${evidence}/automation-suggestions-mobile.png`,fullPage:true,animations:"disabled"});
 await page.getByRole("button",{name:"Preview sequence: Ask for reviews"}).click();
 await expect(page.getByRole("heading",{name:"Post-Tour Review Request",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Use This Template"}).first()).toBeVisible();
 const state=await(await request.get(fixtureOrigin+"/__fixture/state")).json();expect(state.mutations).toEqual([]);expect(state.providerCalls).toBe(0);
 await page.screenshot({path:`${evidence}/review-recipe.png`,fullPage:true,animations:"disabled"});
});

test("automation audience failures do not appear as zero contacts",async({page,request})=>{
 await request.post(fixtureOrigin+"/__fixture/audience-error");
 await page.goto("/marketing/automations");
 await expect(page.getByText("Matching contacts could not be checked.")).toHaveCount(3);
 await expect(page.getByText("0 matching contacts",{exact:false})).toHaveCount(0);
});
test("Vouchers heading sits above the marketing tabs on desktop and mobile",async({page,request})=>{
 for(const width of [1280,390]) {
  await page.setViewportSize({width,height:844});
  await page.goto("/vouchers");
  const heading=page.getByRole("heading",{name:"Vouchers",level:1,exact:true});
  const tabs=page.getByRole("navigation",{name:"Marketing sections"});
  await expect(heading).toBeVisible();
  const headingBox=await heading.boundingBox(),tabsBox=await tabs.boundingBox();
  expect(headingBox!.y+headingBox!.height).toBeLessThan(tabsBox!.y);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${evidence}/vouchers-${width}.png`,fullPage:true,animations:"disabled"});
 }
 const state=await(await request.get(fixtureOrigin+"/__fixture/state")).json();expect(state.mutations).toEqual([]);
});
