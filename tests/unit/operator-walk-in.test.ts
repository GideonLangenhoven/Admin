import {describe,expect,it,vi} from "vitest";
import {sourceFunction} from "../helpers/source-handler";
import {businessDayRange} from "../../app/lib/simple-view";

describe("walk-in departure loading",()=>{
 it("retains launch context when React defers a state updater after the prefill ref is cleared",async()=>{
  let update:((current:string)=>string)|undefined;
  const prefillRef={current:{slotId:"departure-a"}};
  const loadSlots=sourceFunction("app/new-booking/page.tsx","loadSlots",{
   bespoke:false,bookingDate:"2026-10-15",selectedTourId:"tour-a",businessId:"tenant-a",slotRequestRef:{current:0},
   setLoadingSlots:vi.fn(),setSlots:vi.fn(),setSelectedSlotId:(fn:any)=>{update=fn;},
   setPendingMatrixSelection:vi.fn(),setDataError:vi.fn(),pendingMatrixSelection:null,prefillRef,
   dayRange:()=>businessDayRange("2026-10-15","Africa/Johannesburg"),
   listAvailableSlots:async()=>[{id:"departure-a"}],
  });
  await loadSlots();expect(prefillRef.current.slotId).toBe("");expect(update?.("")).toBe("departure-a");
 });
 it("ignores an old activity response and never silently substitutes another departure",async()=>{
  let resolve!:(value:unknown)=>void;const pending=new Promise(done=>{resolve=done;});
  const request={current:0};const selected=vi.fn();const slots=vi.fn();const error=vi.fn();
  const loadSlots=sourceFunction("app/new-booking/page.tsx","loadSlots",{
   bespoke:false,bookingDate:"2026-10-15",selectedTourId:"tour-a",businessId:"tenant-a",slotRequestRef:request,
   setLoadingSlots:vi.fn(),setSlots:slots,setSelectedSlotId:selected,setPendingMatrixSelection:vi.fn(),setDataError:error,
   pendingMatrixSelection:null,prefillRef:{current:{slotId:"departure-a"}},dayRange:()=>businessDayRange("2026-10-15","Africa/Johannesburg"),listAvailableSlots:()=>pending,
  });
  const run=loadSlots();request.current++;resolve([{id:"old-departure"}]);await run;expect(selected).not.toHaveBeenCalled();expect(slots).toHaveBeenCalledExactlyOnceWith([]);expect(error).not.toHaveBeenCalled();
 });
 it("reports unavailable capacity instead of an available zero-result success",async()=>{
  const error=vi.fn();
  const loadSlots=sourceFunction("app/new-booking/page.tsx","loadSlots",{
   bespoke:false,bookingDate:"2026-10-15",selectedTourId:"tour-a",businessId:"tenant-a",slotRequestRef:{current:0},
   setLoadingSlots:vi.fn(),setSlots:vi.fn(),setSelectedSlotId:vi.fn(),setPendingMatrixSelection:vi.fn(),setDataError:error,
   pendingMatrixSelection:null,prefillRef:{current:{slotId:"departure-a"}},dayRange:()=>businessDayRange("2026-10-15","Africa/Johannesburg"),listAvailableSlots:async()=>{throw new Error("offline");},
  });
  await loadSlots();expect(error).toHaveBeenCalledWith("Availability unconfirmed. Refresh before booking.");
 });
});
