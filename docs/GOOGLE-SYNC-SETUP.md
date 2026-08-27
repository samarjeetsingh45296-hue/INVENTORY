# Connecting Google Sheets live sync

The system runs fully without this - every record is already in the database,
which is the master. Connecting Google adds automatic refresh: hourly,
six-hourly or daily per sheet, chosen on the Sheet Sync screen.

One part needs YOUR Google account and takes about five minutes. Nobody else
can do it for you, because it happens inside Google's console while signed in
as the account that owns the sheets.

## Step 1 - create a service account (once)

1. Open https://console.cloud.google.com/ and sign in.
2. Create a project (any name, e.g. "inventory-sync") or pick an existing one.
3. Menu > "APIs & Services" > "Library" > search **Google Sheets API** > Enable.
4. Menu > "IAM & Admin" > "Service Accounts" > "Create service account".
   - Name: `inventory-sync` - no roles needed, just Create and Done.
5. Open the new service account > "Keys" tab > "Add key" > "Create new key"
   > JSON > Create. A `.json` file downloads.

## Step 2 - give the key to the system

Save the downloaded file as exactly:

    C:\Users\Asus\Desktop\INVENTORY\secrets\google-service-account.json

That folder is git-ignored; the key never reaches GitHub.

## Step 3 - share the sheets with the robot

Open the JSON file in Notepad and copy the `client_email` value - it looks
like `inventory-sync@your-project.iam.gserviceaccount.com`.

In EACH Google Sheet: Share > paste that address > set role to **Viewer** >
Send. Viewer is all it ever needs - the system requests the read-only scope,
so it physically cannot modify, rename or delete your sheets.

## Step 4 - restart the API and connect

Run `tools\stop-inventory.cmd`, then `tools\start-inventory.cmd`.

Open **Sheet Sync** in the site. The 13 tabs of your two workbooks are
already registered. For each one you care about:

1. **Map columns** > **Auto-match columns** > correct anything wrong > Save.
2. **Preview** - shows exactly what would change, writes nothing.
3. **Sync now**, or pick a schedule (hourly / 6-hourly / daily).

## What sync will never do

- It never deletes: a row vanishing from a sheet changes nothing here.
- It never overwrites a field someone edited on the website more recently -
  that is reported as a conflict instead.
- It never writes to your sheets - the read-only scope makes that impossible.
