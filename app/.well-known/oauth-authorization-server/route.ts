import { handleAgentMetadata } from "../../lib/agent-mcp";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const GET=()=>handleAgentMetadata("authorization");
