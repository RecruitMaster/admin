const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateYandex } = require('../dist/api/seo/seo.service.js');
const token = 'local-test-oauth-token';
// Documented v4 shape: https://yandex.ru/dev/webmaster/doc/ru/reference/hosts
const host = { host_id: 'https:recruitmaster.net:443', ascii_host_url: 'https://recruitmaster.net/',
    unicode_host_url: 'https://recruitmaster.net/', verified: true };
function provider(hosts = [host]) {
    return async (url, options) => {
        assert.equal(options.headers.Authorization, 'OAuth ' + token);
        assert.equal(options.redirect, 'manual');
        if (url.endsWith('/v4/user')) return new Response('{"user_id":9007199254740993}');
        assert.ok(url.endsWith('/user/9007199254740993/hosts'));
        return Response.json({ hosts });
    };
}
test('connect accepts the documented Yandex host shape without host_url and preserves int64 ID', async () => {
    assert.deepEqual(await validateYandex(token, provider()), { access_token: token });
});
test('connect requires the exact verified main host; no alias, subdomain or legacy field bypass', async () => {
    for (const override of [
        { ascii_host_url: 'https://lk.recruitmaster.net/' }, { ascii_host_url: 'https://evil.example/' },
        { ascii_host_url: undefined, host_url: host.ascii_host_url }, { host_id: 'http:recruitmaster.net:80' },
    ]) await assert.rejects(validateYandex(token, provider([{ ...host, ...override }])), /yandex_host_missing/);
    await assert.rejects(validateYandex(token, provider([{ ...host, verified: false }])), /yandex_host_not_verified/);
    await assert.rejects(validateYandex(token, provider([])), /yandex_host_missing/);
});
test('provider failures become fixed safe codes, never response bodies or network messages', async () => {
    for (const [status, code] of [[401, 'yandex_unauthorized'], [403, 'yandex_forbidden'], [429, 'yandex_unavailable'], [500, 'yandex_unavailable']]) {
        await assert.rejects(validateYandex(token, async () => new Response(token, { status })), new RegExp('^Error: ' + code + '$'));
    }
    await assert.rejects(validateYandex(token, async () => { throw Error(token); }), /^Error: yandex_network_error$/);
    for (const body of ['invalid-json-' + token, 'null', '{}', '{"user_id":"invalid"}'])
        await assert.rejects(validateYandex(token, async () => new Response(body)), /^Error: invalid_yandex_response$/);
    await assert.rejects(validateYandex(token, async url => url.endsWith('/v4/user') ? Response.json({ user_id: 1 }) : Response.json({ hosts: null })), /invalid_yandex_response/);
    await assert.rejects(validateYandex('https://oauth.yandex.ru/#access_token=abc', provider()), /invalid_yandex_token/);
});
