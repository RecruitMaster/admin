# Yandex Webmaster read-only diagnostics v2

For a saved dashboard token followed by `yandex_http_403`, this tool isolates
the failed API request before changing the application or its permissions.

Download `yandex-webmaster-check-v2.txt`, upload it to `/tmp` with `scp`, then
execute `bash /tmp/yandex-webmaster-check-v2.txt` as root via SSH. It loads the
existing Node environment and uses the notification observer's HTTP helper,
the same transport used by the SEO collector.

It reads `/etc/recruitmaster/yandex-webmaster.json` without changing it. It
makes only GET requests to the fixed Yandex Webmaster API: user identity,
host list, and one sample each for in-search pages and appearance/removal events.
If the collector's encoded host path is refused with 400/403/404, it also checks
the documented literal host ID for that same endpoint. No API writes, services,
application sources, credentials, cache or indexing state are changed.

Output includes only fixed stage names, HTTP status, JSON/HTML classification,
allowlisted API error codes and numeric counts/booleans. Tokens, full response
bodies, exception messages, user IDs, sample URLs and Authorization headers
are never printed.

- `ACCESS_FORBIDDEN`: Yandex says the application lacks a required permission.
- `INVALID_OAUTH_TOKEN`: Yandex rejects this credential.
- `INVALID_USER_ID`: Yandex says the path user differs from the token owner;
  an optional boolean compares the available ID without revealing it.
- `HOST_NOT_VERIFIED`: rights are not confirmed for this site/token identity.
- `HOST_NOT_LOADED`: website data has not been loaded into Yandex Webmaster.
- `HOST_NOT_INDEXED`: Yandex reports that the host has not yet been indexed.
- `RESOURCE_NOT_FOUND`: the requested API resource does not exist.
  Version 1 masked these three documented 404 reasons as `OTHER_API_ERROR`.
- `html` + `NO_RECOGNIZED_API_CODE`: refusal did not contain a recognized JSON
  API error. Do not infer token permissions from HTTP status alone.
- Encoded path refusal followed by literal path HTTP 200: investigate host-ID
  path encoding in the collector before changing OAuth permissions.

An HTTP 200 with zero samples is a valid empty response; it does not prove
that every website page is missing from the search index.

Validation: `node --test tests/seo-yandex-check.cjs`; `bash -n` of generated
release. Tests cover lossless IDs, fixed read endpoints, encoded/literal path
comparison, redaction, empty samples and private-file permissions/symlinks.

References:

- https://yandex.ru/dev/webmaster/doc/ru/reference/errors
- https://yandex.ru/dev/webmaster/doc/ru/reference/hosts-indexing-insearch-samples
- https://yandex.ru/dev/webmaster/doc/ru/reference/hosts-search-events-samples
