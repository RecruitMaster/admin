const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { diagnose, readKey } = require('../scripts/seo-dashboard/yandex-check.cjs');
const token = 'private-test-token-never-print';
function fixture(respond) {
    const calls = [];
    return { calls, request: async (url, init) => {
        calls.push(url); assert.equal(init.headers.Authorization, 'OAuth ' + token);
        if (url.endsWith('/v4/user')) return { status: 200, text: '{"user_id":9007199254740993}' };
        assert.ok(url.includes('/user/9007199254740993/hosts'));
        if (url.endsWith('/hosts')) return { status: 200, text: JSON.stringify({ hosts: [
            { host_id: 'https:recruitmaster.net:443', ascii_host_url: 'https://recruitmaster.net/', verified: true }
        ] }) };
        return respond(url, init);
    } };
}
test('diagnostic isolates denied API stage, never echoes body/credentials/IDs, and tests literal host', async () => {
    const f = fixture(url => url.includes('%3A')
        ? { status: 403, text: JSON.stringify({ error_code: 'ACCESS_FORBIDDEN', error_message: token, access_token: token }) }
        : { status: 200, text: JSON.stringify({ count: 10, samples: [{ url: token, title: token }] }) });
    const rows = await diagnose({ request: f.request, token });
    assert.equal(rows.find(r => r.step === 'in_search_encoded_host').apiCode, 'ACCESS_FORBIDDEN');
    assert.equal(rows.find(r => r.step === 'in_search_literal_host').http, 200);
    assert.equal(rows.find(r => r.step === 'events_literal_host').samplesReturned, 1);
    assert.equal(f.calls.length, 6);
    const output = JSON.stringify(rows); assert.ok(!output.includes(token)); assert.ok(!output.includes('9007199254740993'));
    assert.ok(!output.includes('Authorization')); assert.ok(!output.includes('error_message'));
});
test('success, including zero samples, uses only four GET reads with no alternate retries', async () => {
    const f = fixture(() => ({ status: 200, text: '{"count":0,"samples":[]}' }));
    const rows = await diagnose({ request: f.request, token });
    assert.equal(f.calls.length, 4); assert.equal(rows.at(-1).samplesReturned, 0); assert.equal(rows.at(-1).totalReported, 0);
});
test('non-API refusals and exceptions are classified without leaking their content', async () => {
    const f = fixture(() => ({ status: 403, text: '<html>' + token + '</html>' }));
    const rows = await diagnose({ request: f.request, token });
    assert.equal(rows[3].responseFormat, 'html'); assert.equal(rows[3].apiCode, 'NO_RECOGNIZED_API_CODE');
    assert.ok(!JSON.stringify(rows).includes(token));
    const unknown = fixture(() => ({ status: 403, text: JSON.stringify({ code: token }) }));
    assert.equal((await diagnose({ request: unknown.request, token }))[3].apiCode, 'OTHER_API_ERROR');
    const failed = await diagnose({ token, request: async () => { throw Error(token); } });
    assert.deepEqual(failed, [{ step: 'user', status: 'network_error' }]);
});
test('token file stays unchanged and unsafe permissions/symlinks are refused', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandex-check-')), file = path.join(dir, 'key.json');
    try {
        const body = JSON.stringify({ access_token: token }); fs.writeFileSync(file, body, { mode: 0o600 });
        assert.equal(readKey(file), token); assert.equal(fs.readFileSync(file, 'utf8'), body);
        fs.chmodSync(file, 0o644); assert.throws(() => readKey(file)); fs.chmodSync(file, 0o600);
        fs.symlinkSync(file, path.join(dir, 'link')); assert.throws(() => readKey(path.join(dir, 'link')));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('generated Raw script actually invokes diagnostics from stdin without installing or writing', async () => {
    const vm = require('node:vm');
    const shell = fs.readFileSync(path.join(__dirname, '../scripts/releases/yandex-webmaster-check-v1.txt'), 'utf8');
    const source = shell.split("node <<'RECRUITMASTER_YANDEX_CHECK'\n")[1].split('\nRECRUITMASTER_YANDEX_CHECK')[0];
    const output = [], f = fixture(() => ({ status: 200, text: '{"count":0,"samples":[]}' }));
    const fakeFs = {
        constants: fs.constants, openSync: () => 7, closeSync: () => {},
        fstatSync: () => ({ isFile: () => true, uid: 0, mode: 0o600, size: 100 }),
        readFileSync: () => JSON.stringify({ access_token: token }),
    };
    await vm.runInNewContext(source, {
        require: name => {
            if (name === 'node:fs') return fakeFs;
            assert.equal(name, '/opt/recruitmaster-indexing/worker.cjs'); return { request: f.request };
        }, module: { exports: {} }, process: { getuid: () => 0 },
        console: { log: value => output.push(value) },
    });
    assert.equal(f.calls.length, 4); assert.equal(output.length, 6);
    assert.equal(JSON.parse(output.at(-1)).http, 200);
    assert.ok(!output.join('\n').includes(token));
});
