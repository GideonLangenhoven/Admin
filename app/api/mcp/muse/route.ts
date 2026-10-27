import { agentReject } from "../../../lib/agent-config";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// No assumed OpenAI transport/auth adapter for Muse. Its technical contract is
// still required; this explicit closed boundary cannot be enabled by env flags.
export const POST=()=>agentReject("INTEGRATION_DISABLED",503);
export const GET=POST;
export const DELETE=POST;
