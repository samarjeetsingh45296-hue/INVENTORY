-- Extensions the schema relies on.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy search on asset tags / names
CREATE EXTENSION IF NOT EXISTS "unaccent";   -- accent-insensitive search
