ALTER VIEW public.chat_intent_daily SET (security_invoker = on);
REVOKE ALL ON public.chat_intent_daily FROM anon;
REVOKE ALL ON public.chat_intent_daily FROM authenticated;;
