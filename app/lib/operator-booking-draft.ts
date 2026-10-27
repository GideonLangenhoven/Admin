// Volatile, tab-local drafts only: no guest, child or safety details enter browser storage.
const drafts=new Map<string,{at:number;value:Record<string,unknown>}>();
const LIFETIME=20*60*1000;
function prune(now:number){for(const [owner,entry] of drafts)if(now-entry.at>LIFETIME)drafts.delete(owner);}
export function readOperatorBookingDraft(owner:string,now=Date.now()){
 prune(now);
 const entry=drafts.get(owner);if(!entry)return null;
 if(now-entry.at>LIFETIME){drafts.delete(owner);return null;}
 return structuredClone(entry.value);
}
export function saveOperatorBookingDraft(owner:string,value:Record<string,unknown>,now=Date.now()){
 prune(now);
 if(owner)drafts.set(owner,{at:now,value:structuredClone(value)});
}
export function clearOperatorBookingDrafts(owner?:string){if(owner)drafts.delete(owner);else drafts.clear();}
