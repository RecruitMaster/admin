# SEO dashboard for admin.recruitmaster.net

Adds `/seo` and the sidebar entry **SEO · Индексация**. The dashboard reads a private snapshot instead of making search-engine API calls on each page visit. Existing users, roles, activity logs and other admin routes retain their current behavior.

## Data and meaning

- The live main-domain sitemap index and all its child files supply the canonical URL list and counts. Current public vacancy data supplies titles and missing JobPosting source fields, including country/city. A failed catalogue read is explicitly shown as incomplete problem data.
- The existing Google Indexing observer state supplies notification acknowledgements, queue size and last-run counters. Accepted notification, sitemap inclusion and actual index presence are separate columns.
- Google URL Inspection supplies the latest status known to Google's index, coverage reason, last crawl and Google-selected canonical URL. It does not perform a live crawl or submit a URL for indexing. Unknown/unqueried URLs remain unknown; errors never become “not indexed”. Results carry per-URL timestamps and stale markers.
- Google uses the existing service-account JSON and **webmasters.readonly** OAuth scope. There is no new key, OAuth consent flow, Indexing API publish request or changed ownership. Enable Search Console API in `recruit-master-ads`; the existing service account must retain access to `sc-domain:recruitmaster.net`.
- Yandex is optional. Connect an OAuth token with `webmaster:hostinfo` through the admin form. It validates a verified `https://recruitmaster.net/` host before saving. The token is stored only in `/etc/recruitmaster/yandex-webmaster.json` with mode 600, never in the snapshot, HTML, session or repository.
- Yandex's in-search samples are positive evidence for returned URLs; a missing URL stays “not confirmed”. A sampled removal event is displayed as a dated historical exclusion, with its reason. It does not prove permanent/current exclusion. Samples may be capped; no search-result scraping or `site:` counts are used as index evidence.

## Deployment

Prerequisites: the current root-run PM2 `rm-admin`, its existing dependencies/build, Linux/systemd, Node 22+, and the Google Indexing observer already installed at `/opt/recruitmaster-indexing/worker.cjs`. The server in this session uses this layout. The installer refuses ambiguous/incompatible source context and a differently privileged admin process instead of opening private data permissions.

Download `seo-dashboard-install-v4.txt` from the pinned GitHub release into Downloads, then:

```powershell
$file = Join-Path $env:USERPROFILE 'Downloads\seo-dashboard-install-v4.txt'
if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Файл установщика не найден' }
scp $file root@89.108.113.137:/tmp/seo-dashboard-install-v4.txt
if ($LASTEXITCODE -ne 0) { throw 'Ошибка загрузки' }
ssh root@89.108.113.137 'bash /tmp/seo-dashboard-install-v4.txt --check && bash /tmp/seo-dashboard-install-v4.txt'
if ($LASTEXITCODE -ne 0) { throw 'Установка остановлена: смотрите сообщение выше' }
```

Preflight checks source compatibility, current admin availability, public sitemaps, existing observer and read-only Google site-list access. Google setup problems are reported without preventing a useful sitemap/notification dashboard. No inspection or indexing publish requests are sent by `--check`.

Installer v4 retains the v2 structural integration and parses the router with the installed TypeScript library and the sidebar with HTML/EJS validation. It tolerates formatting, renamed identifiers and unrelated routes/menu entries; it refuses conflicting or ambiguous SEO mounts. It never replaces the entire router or sidebar.

The installer stages the admin build, checks for concurrent edits, backs up only the affected sources/build and SEO collector/unit files, then restarts **only the selected admin PM2 process**. It restores admin source/build and SEO units on failure. ATS frontend, backend, nginx, databases, `.env`, Google credentials and the existing notification observer are untouched. SEO cache/quota and tokens are never rolled back or copied into backups.

Successful output: `Installed: seo-dashboard-v4`. Open `https://admin.recruitmaster.net/seo` after signing in. The first snapshot appears after a few minutes; Google status fills in batches. Lovable publication is not required for this admin update.

Version 3 fixes native Yandex form submission under Helmet: the private SEO routes use `Referrer-Policy: same-origin`, preserving trusted Origin validation. Invalid session form tokens redirect with status 303 to a fresh dashboard form; successful and failed connections also use 303, so refresh does not resubmit credentials. Foreign/null Origins remain rejected; session/role/CSRF checks are retained. Those form protections remain in v4. The v4 installer supports a fresh install and an upgrade from v3, preserving unrelated source edits.

Version 4 corrects the Yandex v4 host schema in both credential validation and the collector: the documented address field is `ascii_host_url`, not `host_url`. An exact main-domain `host_id`, URL and verified flag are still required. Failed connections show fixed messages for invalid tokens, HTTP 401/403, missing/unverified host, network/API problems and local storage failure; upstream response bodies, exception messages and credentials are never reflected.

## Collector and quotas

- `/opt/recruitmaster-seo/collector.cjs`, `recruitmaster-seo-snapshot.service` and `.timer`.
- Every 15 minutes after the last run. An exclusive flock prevents overlap. The collector is isolated from the admin request lifecycle and PM2 restarts.
- Up to 50 Google URL inspections per run, approximately once per 24 hours per URL, with a conservative local cap of 1,000 attempts per Pacific day. At 506 URLs the first complete sweep takes about three hours. This is separate from the Indexing observer's 200-publish budget. Other clients can share Google's site/project quotas; 403/429 cause a persisted pause.
- Quota reservations are saved before HTTP calls. State is private, atomic and fsynced. Corruption stops the collector; it is never silently reset. Search-engine failures preserve prior timestamped results, and a failed sitemap scan preserves the previous snapshot.
- Yandex refreshes at most every 12 hours after connection. Up to 10,000 in-search sample URLs and the first 100 event samples are read; absence from those samples is never treated as a negative index result.
- At most 500 sitemap files / 10,000 current canonical URLs. Larger inputs fail explicitly rather than silently truncating.
- Snapshot and inspection cache: `/var/lib/recruitmaster-seo/`, root-owned mode 700; files mode 600. No bearer tokens or private keys are stored in snapshot/state.
- Administrators are revalidated against current database role/status on every SEO request. Routes use private/no-store and noindex headers. Credential changes require a per-session CSRF token and trusted Origin when present. Values are escaped in EJS; only fixed main-domain page links are emitted.

## Diagnostics / stopping

```powershell
ssh root@89.108.113.137 'journalctl -u recruitmaster-seo-snapshot.service -n 15 --no-pager'
```

The journal logs only URL count, connection status/error codes and snapshot time. If Google returns `google_inspect_403`, check the enabled Search Console API and service-account property access. For Yandex, the dashboard shows its connection errors and offers reconnect/disconnect. Never paste tokens into chat.

```powershell
ssh root@89.108.113.137 'systemctl disable --now recruitmaster-seo-snapshot.timer && systemctl stop recruitmaster-seo-snapshot.service'
```

Stopping this collector leaves the dashboard's timestamped snapshot and the separate vacancy-notification observer intact.

## Validation

`npm run build`; `node --test tests/seo-collector.cjs tests/seo-dashboard.cjs tests/seo-integrator.cjs tests/seo-yandex.cjs`; `python3 tests/seo-installer.py`; local synthetic Chromium checks at 1440 and 390 px; `PLAYWRIGHT_MODULE=/tmp/rm-vacancy-duty-labels/node_modules/playwright node tests/seo-dashboard-auth.browser.cjs` exercises native forms with real Helmet/session middleware, mocked API/storage and HTTPS traffic resolved exclusively to the local TLS fixture. Generated installer payload is checked against the reviewed files. No production database or real Google/Yandex credentials are used by local tests. Actual server/systemd/API checks run during the user-executed installer.

References:

- https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- https://developers.google.com/webmaster-tools/limits
- https://yandex.ru/dev/webmaster/doc/ru/reference/hosts
- https://yandex.ru/dev/webmaster/doc/ru/reference/hosts-indexing-insearch-samples
- https://yandex.ru/dev/webmaster/doc/ru/reference/hosts-search-events-samples
