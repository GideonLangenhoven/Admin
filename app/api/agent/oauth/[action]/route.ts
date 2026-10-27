import { handleOAuth } from "../../../../lib/agent-oauth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;
type Context={ params:Promise<{ action:string }> };
export async function GET(request:Request,context:Context) { return handleOAuth(request,(await context.params).action); }
export const POST=GET;
