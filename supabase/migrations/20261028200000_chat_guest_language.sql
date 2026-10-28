-- Guest-language chat (owner decision 2026-10-28): both bots detect the guest's
-- language and translate what goes out; the team Inbox shows an English copy.
-- conversations.language: the guest's language (ISO 639-1), NULL = English.
-- chat_messages.body_en: the English copy of a message that isn't in English
-- (a guest's message translated, or the team's original before translation).
-- Both tables are already business-scoped with RLS; new columns inherit it.
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS language text
  CHECK (language IS NULL OR language ~ '^[a-z]{2}$');
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS body_en text;
