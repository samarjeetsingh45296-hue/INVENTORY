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

---

# Option B - MongoDB Atlas (cloud copy of the data)

The website keeps running on PostgreSQL; Atlas holds a structured cloud copy
of every record - refresh it whenever you like. If you want the live database
itself in the cloud, use the Neon route above instead. Both are free.

## Your five minutes

1. Go to https://www.mongodb.com/cloud/atlas/register and sign up
   (Google login works).
2. It offers to deploy a cluster - choose the **M0 Free** tier, any region,
   and press Create.
3. When asked to create a **database user**, set a username and password and
   note them down.
4. Under **Network Access**, press "Add IP Address" and choose
   **Allow access from anywhere** (0.0.0.0/0) - simplest while the site runs
   on a laptop whose address changes.
5. Press **Connect > Drivers** and copy the connection string. Replace
   `<password>` inside it with the database user's password. It looks like:

       mongodb+srv://user:password@cluster0.abc12.mongodb.net/

6. Double-click:

       C:\Users\Asus\Desktop\INVENTORY\tools\save-to-cloud.cmd

7. Paste the string. All seven collections upload and verify themselves.

`save-to-cloud.cmd` accepts either kind of string - it recognises Atlas
(`mongodb+srv://`) and Neon (`postgresql://`) automatically and runs the
right path, so there is one tool to remember.

## Keeping the cloud copy fresh

After the first run the destination is remembered in `.env` (MONGODB_URI),
so refreshing is just:

    cd C:\Users\Asus\Desktop\INVENTORY\apps\api
    pnpm export:mongo

or run save-to-cloud.cmd again with the same string. Re-runs update in
place - nothing duplicates.
