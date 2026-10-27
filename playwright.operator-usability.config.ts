import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:"./tests/e2e",testMatch:"operator-usability-mocked.spec.ts",workers:1,retries:0,expect:{timeout:20000},timeout:90000,reporter:"list",use:{baseURL:"http://127.0.0.1:3160",browserName:"chromium",channel:"chrome",timezoneId:"America/Los_Angeles",trace:"retain-on-failure"}});
