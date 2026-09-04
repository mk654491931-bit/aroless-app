-- =============================================================================
-- Migration: Backfill empty public icon columns
-- Date: 2026-09-04
-- =============================================================================
-- Replaces NULL, empty, and whitespace-only values in character-based public
-- columns whose names contain "icon" with a valid lucide-react icon name.
-- =============================================================================

DO $$
DECLARE
  column_record record;
  updated_rows bigint;
  default_icon constant text := 'CircleHelp';
BEGIN
  FOR column_record IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name ILIKE '%icon%'
      AND data_type IN ('text', 'character varying', 'character')
  LOOP
    EXECUTE format(
      'UPDATE %I.%I
       SET %I = $1
       WHERE %I IS NULL OR btrim(%I::text) = ''''',
      'public',
      column_record.table_name,
      column_record.column_name,
      column_record.column_name,
      column_record.column_name
    )
    USING default_icon;

    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    RAISE NOTICE 'Updated %.%: % row(s)',
      column_record.table_name,
      column_record.column_name,
      updated_rows;
  END LOOP;
END;
$$;