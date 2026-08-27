# Moving the database to the cloud

After this, every change made on the website is stored in a cloud PostgreSQL,
not on the laptop. The laptop can be formatted tomorrow and no record is lost.

MongoDB is not needed for this. The cloud part is about WHERE the database
runs, not WHICH database it is - and cloud PostgreSQL has free tiers exactly
like MongoDB Atlas does. Keeping PostgreSQL keeps everything this system's
safety is built on: the tamper-proof change history, the one-holder-per-asset
rule, and transactions that never half-apply.

## Your five minutes (only you can do this part - it is a sign-up)

1. Go to https://neon.tech and click **Sign up** (GitHub or Google login works).
   Neon's free tier is enough for this system many times over.
2. It creates a project immediately. On the project page press
   **Connect** and copy the **connection string** - one long line like:

       postgresql://neondb_owner:AbC123xyz@ep-cool-hall-a1b2c3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require

3. Double-click:

       C:\Users\Asus\Desktop\INVENTORY\tools\move-database-to-cloud.cmd

4. Paste the connection string when asked. Watch the six steps run.
5. Run `tools\stop-inventory.cmd`, then `tools\start-inventory.cmd`.

That is the whole move.

## What the tool does, and refuses to do

It tests the connection, dumps the laptop database (kept in `backups\`),
restores everything into the cloud, re-applies the database-level protections
(append-only triggers, actor foreign keys, unique indexes - `pg_restore` does
not carry those), then compares row counts table by table. **Only if every
table matches** does it point `.env` at the cloud. On any mismatch it stops
and the laptop stays in charge.

The laptop database is never modified. It remains as a local fallback.

## After the move

- The site still runs on the laptop; its data lives in the cloud. Publishing
  the website itself to a server is a separate later step, and the database
  part will already be done.
- Nightly backups keep running and now capture the cloud database.
- If the internet drops, the site cannot reach its data until it returns -
  that is the honest trade of a cloud database.
- To go back: open `.env`, delete the new DATABASE_URL line, uncomment the
  old one, restart. The laptop copy is exactly as it was at the move.

## Supabase instead of Neon?

Works identically - sign up at https://supabase.com, create a project, copy
the connection string from Project Settings > Database (use the "Direct
connection" string), and run the same tool.
