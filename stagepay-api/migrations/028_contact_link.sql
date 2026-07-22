-- Optional public contact link for the showcase page (Instagram, LinkedIn,
-- portfolio site, a WhatsApp Business link, or a mailto: address) — lets a
-- visitor reach the designer without the designer ever publishing a
-- personal phone number. Nullable; no contact button shows on the public
-- page until a designer sets one.
ALTER TABLE users ADD COLUMN contact_link TEXT;
