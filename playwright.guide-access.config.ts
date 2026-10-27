import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:"./tests/e2e",testMatch:"guide-access-mocked.spec.ts",workers:1,retries:0,timeout:90000,expect:{timeout:20000},reporter:"list",use:{baseURL:process.env.GUIDE_PREVIEW_ORIGIN||"http://127.0.0.1:3174",browserName:"chromium",channel:"chrome",trace:"retain-on-failure"}});
