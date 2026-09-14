# Backups and restore

Firestore does not back itself up. A bad write, a deleted customer, a script
run against the wrong project — all of those are permanent unless one of the
things below is switched on first. Everything here runs with `gcloud` as an
owner of project `grimeline-5e3d8`; none of it can be done from inside the
app or from this repository.

Do the first two today. They take five minutes and cost very little.

## 1. Point-in-time recovery (the undo button)

Lets you read the database as it was at any moment in the last seven days.
This is what saves you from "I deleted the wrong customer at 3pm".

```bash
gcloud firestore databases update --database='(default)' --enable-pitr
```

Reading an old state does not need a restore: in the console, Firestore →
Data → the clock icon, pick a time. To bring a single document back, read it
at the old time and write it again.

## 2. A daily backup, kept for two weeks

Full copies, taken automatically, kept on Google's side.

```bash
gcloud firestore backups schedules create \
  --database='(default)' \
  --recurrence=daily \
  --retention=14d
```

Check it exists and see what it has taken:

```bash
gcloud firestore backups schedules list --database='(default)'
gcloud firestore backups list
```

## 3. An export you hold yourself (before anything risky)

Before an import script, a migration, or anything that touches many rows:

```bash
# once
gsutil mb -l us-central1 gs://grimeline-5e3d8-exports

# each time
gcloud firestore export gs://grimeline-5e3d8-exports/$(date +%Y%m%d-%H%M)
```

The bucket holds customers' addresses and phone numbers. Keep it private
(the default), and do not commit anything from it — the repository is public.

## 4. The sign-in accounts

Firestore holds the profiles; Firebase Auth holds the accounts. Separate
system, separate export:

```bash
npx firebase auth:export auth-users.json --project grimeline-5e3d8
```

The file contains password hashes. Keep it encrypted and off the repository.

## 5. Job photos

Storage bucket `grimeline-5e3d8.appspot.com`. Two options, either is fine:

```bash
# keep old versions when a photo is overwritten or deleted
gsutil versioning set on gs://grimeline-5e3d8.appspot.com

# or copy to a second bucket now and then
gsutil -m rsync -r gs://grimeline-5e3d8.appspot.com gs://grimeline-5e3d8-photos-backup
```

## Restoring — read this before you need it

A backup restores into a **new** database, not over `(default)`. The app only
talks to `(default)`. So a restore is three steps, not one:

```bash
# 1. restore the backup into a fresh database
gcloud firestore backups list          # find the backup name
gcloud firestore databases restore \
  --source-backup=projects/grimeline-5e3d8/locations/LOCATION/backups/BACKUP_ID \
  --destination-database=restored

# 2. export the restored database to a bucket
gcloud firestore export gs://grimeline-5e3d8-exports/restore-$(date +%Y%m%d) \
  --database=restored

# 3. import that export over (default)
gcloud firestore import gs://grimeline-5e3d8-exports/restore-YYYYMMDD \
  --database='(default)'
```

Step 3 overwrites documents with the same ids and leaves others alone. For a
partial restore — one collection — add `--collection-ids=customers` to the
export in step 2. Delete the `restored` database afterwards so it is not
billed:

```bash
gcloud firestore databases delete --database=restored
```

Firestore rules, indexes and the app itself are in this repository and
deploy from `main`; they are not part of any of the above and do not need to
be.

## What to do once a quarter

Restore last night's backup into a scratch database, open it in the console,
find a customer you know. Then delete the scratch database. A backup that has
never been restored is a hope, not a backup.
