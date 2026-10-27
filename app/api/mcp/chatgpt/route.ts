import { handleMcp } from "../../../lib/agent-mcp";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;
export const POST=(request:Request)=>handleMcp(request,"CHATGPT");
export const GET=(request:Request)=>handleMcp(request,"CHATGPT");
export const DELETE=(request:Request)=>handleMcp(request,"CHATGPT");
