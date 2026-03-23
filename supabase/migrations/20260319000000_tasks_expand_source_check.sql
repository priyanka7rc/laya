-- Expand the tasks source check constraint to include all web/whatsapp source variants
-- previously only 'web' and 'whatsapp' were allowed, blocking web_brain_dump, web_media, web_keyboard etc.

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_source_check
  CHECK (source IN (
    'web',
    'whatsapp',
    'web_keyboard',
    'web_brain_dump',
    'web_media',
    'whatsapp_text',
    'whatsapp_media'
  ));
