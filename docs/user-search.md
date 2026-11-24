# Admin user search

`/users` searches registered accounts, including recruiter role 2 and candidate
role 4. Imported ATS candidate records without a user account are not part of
this existing users table. No public directory endpoint is changed.

The GET form searches name, surname, email, company and the textual account UUID.
Words are ANDed across those fields, without case sensitivity, so either name
order works. Values are bound parameters; `%`, `_` and backslash are literals,
not a way to request every account. Input accepts at most 200 characters and
12 words; structured/duplicate search parameters and unknown roles are rejected.
Soft-deleted accounts retain the repository's existing exclusion.

Filtering precedes count and pagination. Role/search persist in pagination URLs
and on reload; submitting a new search resets the page. Out-of-range pages are
clamped. Ordering includes account UUID as a stable creation-date tie breaker.
No automatic search requests, writes, messages, dependency or schema changes.

Validation (synthetic fixtures only):

- `npm ci && npm run build`
- `PGLITE_MODULE=/path/to/@electric-sql/pglite node tests/user-search.cjs`
- `PGLITE_MODULE=/path/to/@electric-sql/pglite PLAYWRIGHT_MODULE=/path/to/playwright node tests/user-search.browser.cjs`
- `python3 tests/admin-search-installer.py`
- Existing personal-mail and role-label tests also pass.

PGlite is a disposable PostgreSQL/WASM test engine, installed outside the project;
no production database or mail server is used by these tests. Browser tests use
the real compiled controller and EJS views, including the existing session guard.

## Production

Download `scripts/releases/admin-user-search-install.txt` and run it through the
existing ATS server SSH connection: `bash /tmp/admin-user-search-install.txt`.
`--check` performs compatibility and existing-login health checks only.
The installer discovers exactly one online PM2 application whose checkout has
the admin controller/views and Express/EJS/TypeORM dependencies. It does not
assume the admin application directory or PM2 name, or select the ATS backend.

Only four source paths are patched. The current checkout's other additions are
preserved; a complete feature-branch pull is unnecessary. Build takes place
outside the watched application directory using its existing dependencies.
Source/build backups precede publication. Only that admin process is restarted;
login health is checked and failure restores the prior source/build. No `.env`
contents are printed or included in the release, and no migrations are run.
A second install is a no-op. Unexpected source or process state stops deployment.

To roll back manually, use the printed private backup directory and its
`manifest.json`: restore the listed original source files (remove those marked
absent), restore the backed-up `dist`, then restart only `processId` from the
manifest. Preserve any later edits before restoring an older backup.
