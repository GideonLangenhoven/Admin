import {beforeEach,describe,expect,it} from "vitest";
import {readOperatorBookingDraft,saveOperatorBookingDraft,clearOperatorBookingDrafts} from "../../app/lib/operator-booking-draft";
beforeEach(()=>clearOperatorBookingDrafts());
describe("volatile operator booking drafts",()=>{
 it("keeps edits scoped to staff, tenant and launch context",()=>{saveOperatorBookingDraft("staff-a:tenant-a:slot-a",{adults:2,children:1,safety:"Synthetic answer"},0);expect(readOperatorBookingDraft("staff-a:tenant-a:slot-a",1)).toMatchObject({children:1});expect(readOperatorBookingDraft("staff-b:tenant-a:slot-a",1)).toBeNull();expect(readOperatorBookingDraft("staff-a:tenant-b:slot-a",1)).toBeNull();});
 it("expires after 20 minutes and clears on sign-out",()=>{saveOperatorBookingDraft("a",{name:"Synthetic"},0);expect(readOperatorBookingDraft("a",20*60*1000+1)).toBeNull();saveOperatorBookingDraft("a",{name:"Synthetic"});clearOperatorBookingDrafts();expect(readOperatorBookingDraft("a")).toBeNull();});
 it("does not share mutable form objects",()=>{const fields={safety:"Synthetic"};saveOperatorBookingDraft("a",{fields});fields.safety="changed";expect(readOperatorBookingDraft("a")).toMatchObject({fields:{safety:"Synthetic"}});});
});
