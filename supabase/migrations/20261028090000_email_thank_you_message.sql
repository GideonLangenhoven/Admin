-- Operator-set thank-you paragraph for the post-trip (Trip Photos) email.
-- NULL = keep the built-in "Thank you for <verb> with <brand>…" wording.
alter table businesses add column if not exists email_thank_you_message text;
