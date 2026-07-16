-- Drop 3-versions-per-item down to 1, and switch media tracking from a
-- plain filename string to a real R2-backed {key, fileName} record.
ALTER TABLE item_versions ADD COLUMN media_files TEXT NOT NULL DEFAULT '[]';
ALTER TABLE item_versions DROP COLUMN media_file_name;
ALTER TABLE item_versions DROP COLUMN media_kind;
DELETE FROM item_versions WHERE version_number != 1;
ALTER TABLE items DROP COLUMN selected_version;

ALTER TABLE stage1_brief ADD COLUMN logo_media TEXT NOT NULL DEFAULT '{}';
ALTER TABLE stage1_brief ADD COLUMN product_photos TEXT NOT NULL DEFAULT '[]';
ALTER TABLE stage1_brief DROP COLUMN logo_file_name;
ALTER TABLE stage1_brief DROP COLUMN product_photo_file_names;
