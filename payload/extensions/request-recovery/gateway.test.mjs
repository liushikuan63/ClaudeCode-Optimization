import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRecovery as createRecoveryRuntime, createRecoveryServer, recoveryBoundary, responseRecoveryBoundary, isTurnLimit, isContextLimit, isTransient, inspectSse, failureDetails, retryAfterMs } from './gateway.mjs';

const TEST_UPSTREAM = 'http://127.0.0.1:19999';
const createRecovery = options => createRecoveryRuntime({ upstream: TEST_UPSTREAM, ...options });
const auth = { 'x-api-key': 'offline-only-key', 'content-type': 'application/json' };
const limit = () => Response.json({ type: 'error', error: { type: 'invalid_request_error', code: 'session_turn_limit_exceeded', message: 'This conversation has reached 105 model turns.' } }, { status: 400 });
const answer = text => Response.json({ id: 'msg_offline', type: 'message', role: 'assistant', model: 'offline-model', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
const complete = text => sse([{ type: 'message_start', message: { id: 'msg_complete', type: 'message', role: 'assistant', model: 'offline-model', content: [], usage: { input_tokens: 1, output_tokens: 0 } } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }, { type: 'message_stop' }]);
function history(id, count = 105) {
  const messages = [{ role: 'user', content: `Task ${id}: preserve pending objective; previously completed write must not run again.` }];
  for (let i = 0; i < count; i++) messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `${id}-call-${i}`, name: 'Read', input: { file_path: `D:/offline/${id}/${i}.txt` } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: `${id}-call-${i}`, content: `completed ${i}` }] });
  return { model: 'offline-model', max_tokens: 4096, stream: false, system: 'Original permissions remain in force.', metadata: { user_id: JSON.stringify({ device_id: 'offline', account_uuid: 'offline', session_id: id }) }, tools: [{ name: 'Read', description: 'offline read', input_schema: { type: 'object', properties: {} } }], messages };
}
const session = body => JSON.parse(body.metadata.user_id).session_id;
const isSummary = body => typeof body.system === 'string' && body.system.startsWith('Summarize this historical coding transcript');
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-recovery-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

const gatewayPath = fileURLToPath(new URL('./gateway.mjs', import.meta.url));

test('requires an explicit HTTP loopback upstream with a port', () => {
  assert.throws(() => createRecoveryRuntime(), /explicit HTTP loopback URL with a port/);
  for (const upstream of ['http://127.0.0.1', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://localhost:1234', 'https://127.0.0.1:1234', 'http://example.invalid:1234', 'http://user:pass@127.0.0.1:1234', 'http://127.0.0.1:1234/proxy']) {
    assert.throws(() => createRecoveryRuntime({ upstream }), /explicit HTTP loopback URL with a port/, upstream);
  }
  assert.doesNotThrow(() => createRecoveryRuntime({ upstream: TEST_UPSTREAM }));
  assert.throws(() => createRecoveryServer(), /explicit HTTP loopback URL with a port/);
});

test('recovery listener defaults to loopback and rejects public binds', async () => {
  const { server } = createRecoveryServer({ upstream: TEST_UPSTREAM });
  assert.throws(() => server.listen(0, '0.0.0.0'), /bind to a loopback IP literal/);
  assert.throws(() => server.listen(0, 'localhost'), /bind to a loopback IP literal/);
  server.listen(0);
  await once(server, 'listening');
  assert.equal(server.address().address, '127.0.0.1');
  await close(server);
});

test('command-line runtime requires explicit endpoint and port before creating state', t => {
  const home = temporary(t);
  for (const values of [
    { CC_RECOVERY_PORT: '', CC_RECOVERY_UPSTREAM: '' },
    { CC_RECOVERY_PORT: '19333', CC_RECOVERY_UPSTREAM: '' },
    { CC_RECOVERY_PORT: '65536', CC_RECOVERY_UPSTREAM: TEST_UPSTREAM }
  ]) {
    const result = spawnSync(process.execPath, [gatewayPath], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, ...values, CC_RECOVERY_HOME: home }
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /CC_RECOVERY_(?:PORT|UPSTREAM)/);
    assert.deepEqual(fs.readdirSync(home), []);
  }
});

test('only actual turn-limit errors trigger history recovery', () => {
  assert.equal(isTurnLimit({ error: { code: 'session_turn_limit_exceeded' } }), true);
  assert.equal(isTurnLimit({ error: { message: 'This conversation has reached 105 model turns.' } }), true);
  assert.equal(isTurnLimit({ error: { message: 'invalid API key' } }), false);
  assert.equal(isTurnLimit({ content: 'session_turn_limit_exceeded' }), false);
  assert.equal(isTransient(401, { error: { message: 'authentication failed' } }), false);
  assert.equal(isTransient(400, { error: { message: 'unsupported model' } }), false);
  assert.equal(isTransient(502, {}), true);
});

test('checkpoint boundary never separates tool calls from results', () => {
  const body = history('boundaries', 15);
  const index = recoveryBoundary(body.messages);
  const prefix = body.messages.slice(0, index);
  const calls = prefix.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === 'tool_use').map(block => block.id) : []);
  const results = prefix.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === 'tool_result').map(block => block.tool_use_id) : []);
  assert.deepEqual(calls, results);
  assert.equal(body.messages[index].role, 'assistant');
  assert.equal(body.messages.slice(index).filter(message => message.role === 'assistant').length, 8);
});

test('105 turns recover with model, permissions, tools, recent results and original history intact', async t => {
  const stateDir = temporary(t);
  const body = history('first-session');
  const original = JSON.stringify(body);
  const sent = [];
  const logs = [];
  const recovery = createRecovery({ stateDir, delays: [], logger: entry => logs.push(entry), fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    sent.push({ body: request, headers: new Headers(options.headers) });
    if (isSummary(request)) { assert.equal(request.tools, undefined); assert.equal(request.messages.filter(message => message.role === 'assistant').length, 0); assert.match(request.messages[0].content, /pending objective/); return answer('Task first-session remains open; reads completed; original permissions remain unchanged.'); }
    return request.messages.filter(message => message.role === 'assistant').length >= 100 ? limit() : answer('continued');
  } });
  const result = await recovery.recover('/claude-desktop/v1/messages', body, auth, new AbortController().signal);
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(body), original);
  assert.equal(recovery.stats.checkpoints, 1);
  const resumed = sent.at(-1).body;
  assert.equal(resumed.model, body.model);
  assert.equal(resumed.system, body.system);
  assert.deepEqual(resumed.tools, body.tools);
  assert.deepEqual(resumed.messages.slice(1), body.messages.slice(-16));
  assert.notEqual(session(resumed), session(body));
  assert.equal(sent.at(-1).headers.get('x-api-key'), auth['x-api-key']);
  assert.ok(!JSON.stringify(logs).includes(auth['x-api-key']));
  assert.ok(!JSON.stringify(logs).includes('pending objective'));
  assert.equal(fs.readdirSync(stateDir).filter(name => name.endsWith('.json')).length, 1);
});

test('durable checkpoint is reused across processes only for the exact history prefix', async t => {
  const stateDir = temporary(t);
  const body = history('durable-session');
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body);
    if (isSummary(request)) return answer('durable summary');
    return request.messages.filter(message => message.role === 'assistant').length >= 100 ? limit() : answer('ok');
  };
  await createRecovery({ stateDir, delays: [], fetchImpl }).recover('/v1/messages', body, auth, new AbortController().signal);
  const sent = [];
  const next = createRecovery({ stateDir, delays: [], fetchImpl: async (url, options) => { sent.push(JSON.parse(options.body)); return fetchImpl(url, options); } });
  const extended = { ...body, messages: [...body.messages, { role: 'assistant', content: 'completed later action' }, { role: 'user', content: 'continue pending work' }] };
  await next.recover('/v1/messages', extended, auth, new AbortController().signal);
  assert.equal(next.stats.summaryCalls, 0);
  assert.equal(sent.length, 1);
  assert.match(sent[0].messages[0].content[0].text, /durable summary/);
  const changed = structuredClone(extended);
  changed.messages[0].content = 'Changed source task must not inherit the previous summary';
  await next.recover('/v1/messages', changed, auth, new AbortController().signal);
  assert.ok(next.stats.summaryCalls > 0);
});

test('parallel sessions have independent summaries, aliases and durable checkpoints', async t => {
  const stateDir = temporary(t);
  const resumed = new Map();
  const bodies = ['parallel-a', 'parallel-b'].map(id => history(id));
  const recovery = createRecovery({ stateDir, delays: [], fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    if (isSummary(request)) {
      const id = request.messages[0].content.includes('parallel-a') ? 'parallel-a' : 'parallel-b';
      await new Promise(resolve => setImmediate(resolve));
      return answer(`Summary exclusively for ${id}`);
    }
    if (request.messages.filter(message => message.role === 'assistant').length >= 100) return limit();
    const id = request.messages.at(-1).content[0].tool_use_id.startsWith('parallel-a') ? 'parallel-a' : 'parallel-b';
    resumed.set(id, request);
    return answer(id);
  } });
  await Promise.all(bodies.map(body => recovery.recover('/v1/messages', body, auth, new AbortController().signal)));
  for (const id of ['parallel-a', 'parallel-b']) {
    const other = id === 'parallel-a' ? 'parallel-b' : 'parallel-a';
    assert.match(resumed.get(id).messages[0].content[0].text, new RegExp(id));
    assert.ok(!resumed.get(id).messages[0].content[0].text.includes(other));
  }
  assert.notEqual(session(resumed.get('parallel-a')), session(resumed.get('parallel-b')));
  assert.equal(fs.readdirSync(stateDir).filter(name => name.endsWith('.json')).length, 2);
});

test('cancellation during checkpoint neither retries the task nor writes state', async t => {
  const stateDir = temporary(t);
  const controller = new AbortController();
  let business = 0;
  const recovery = createRecovery({ stateDir, delays: [], fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    if (isSummary(request)) { controller.abort(new Error('human stop')); throw controller.signal.reason; }
    business++; return limit();
  } });
  await assert.rejects(recovery.recover('/v1/messages', history('cancel-session'), auth, controller.signal), /human stop/);
  assert.equal(business, 1);
  assert.equal(fs.readdirSync(stateDir).length, 0);
});

test('old image payloads remain native attachments without entering textual summary input', async () => {
  const body = history('images');
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'offline-image-sentinel' } };
  body.messages[0].content = [{ type: 'text', text: 'Task with image' }, image];
  let resumed;
  const recovery = createRecovery({ delays: [], fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    if (isSummary(request)) { assert.ok(!request.messages[0].content.includes('offline-image-sentinel')); assert.match(request.messages[0].content, /retained_attachment/); return answer('Image retained by attachment reference'); }
    if (request.messages.filter(message => message.role === 'assistant').length >= 100) return limit();
    resumed = request; return answer('done');
  } });
  await recovery.recover('/v1/messages', body, auth, new AbortController().signal);
  assert.deepEqual(resumed.messages[0].content[1], image);
});

test('authentication and permanent request errors are returned without retry or compaction', async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0;
    const recovery = createRecovery({ delays: [0, 0], fetchImpl: async () => { calls++; return Response.json({ error: { type: 'invalid_request_error', message: 'permanent failure' } }, { status }); } });
    const result = await recovery.recover('/v1/messages', history(`permanent-${status}`), auth, new AbortController().signal);
    assert.equal(result.status, status);
    assert.equal(calls, 1);
    assert.equal(recovery.stats.checkpoints, 0);
  }
});

test('transient HTTP and pre-response connection failures have a finite retry budget', async () => {
  let calls = 0;
  const recovery = createRecovery({ delays: [0, 0], fetchImpl: async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('offline reset'), { code: 'ECONNRESET' });
    if (calls === 2) return Response.json({ error: { message: 'temporarily unavailable' } }, { status: 503 });
    return answer('recovered');
  } });
  const result = await recovery.recover('/v1/messages', history('transient', 1), auth, new AbortController().signal);
  assert.equal(result.status, 200);
  assert.equal(calls, 3);
  let exhausted = 0;
  const bounded = createRecovery({ delays: [0, 0], fetchImpl: async () => { exhausted++; return Response.json({ error: { message: 'unavailable' } }, { status: 503 }); } });
  assert.equal((await bounded.recover('/v1/messages', history('bounded', 1), auth, new AbortController().signal)).status, 503);
  assert.equal(exhausted, 3);
});

test('an incomplete tool-use stream is discarded before retry', async () => {
  let calls = 0;
  const partial = sse([{ type: 'message_start', message: { id: 'discarded', content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'must-never-reach-client', name: 'Write', input: {} } }]);
  const recovery = createRecovery({ delays: [0], fetchImpl: async () => {
    calls++;
    return new Response(calls === 1 ? partial : complete('only completed response'), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const result = await recovery.recover('/v1/messages', { ...history('stream', 1), stream: true }, auth, new AbortController().signal);
  assert.equal(calls, 2);
  assert.ok(!result.body.toString().includes('must-never-reach-client'));
  assert.equal(inspectSse(result.body).text, 'only completed response');
});

test('a valid tool response is forwarded once without speculative retry', async () => {
  const response = sse([{ type: 'message_start', message: { id: 'tool-message', content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'only-once', name: 'Read', input: {} } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' }]);
  let calls = 0;
  const recovery = createRecovery({ delays: [0], fetchImpl: async () => { calls++; return new Response(response, { headers: { 'content-type': 'text/event-stream' } }); } });
  const result = await recovery.recover('/v1/messages', { ...history('valid-tool', 1), stream: true }, auth, new AbortController().signal);
  assert.equal(result.body.toString(), response);
  assert.equal(calls, 1);
});

test('failed or truncated summaries never replace original history', async t => {
  const stateDir = temporary(t);
  let business = 0;
  const recovery = createRecovery({ stateDir, delays: [], fetchImpl: async (url, options) => {
    if (isSummary(JSON.parse(options.body))) return Response.json({ type: 'message', content: [{ type: 'text', text: 'truncated' }], stop_reason: 'max_tokens' });
    business++; return limit();
  } });
  await assert.rejects(recovery.recover('/v1/messages', history('truncation'), auth, new AbortController().signal), { code: 'SUMMARY_FAILED' });
  assert.equal(business, 1);
  assert.equal(fs.readdirSync(stateDir).length, 0);
});

test('HTTP gateway forwards only heartbeat before a complete replacement stream', async t => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const upstream = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    calls++;
    if (calls === 1) { res.end(sse([{ type: 'message_start', message: { id: 'partial', content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'forbidden-partial-tool', name: 'Write', input: {} } }])); return; }
    res.flushHeaders();
    await ready;
    res.end(complete('safe completion'));
  });
  const upstreamUrl = await listen(upstream);
  const { server } = createRecoveryServer({ upstream: upstreamUrl, delays: [0] });
  const gatewayUrl = await listen(server);
  t.after(async () => { await close(server); await close(upstream); });
  const response = await fetch(gatewayUrl + '/claude-desktop/v1/messages', { method: 'POST', headers: auth, body: JSON.stringify({ ...history('http-stream', 1), stream: true }) });
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.match(Buffer.from(first.value).toString(), /"type":"ping"/);
  assert.ok(!Buffer.from(first.value).toString().includes('forbidden-partial-tool'));
  release();
  const chunks = [Buffer.from(first.value)];
  for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(Buffer.from(next.value)); }
  const output = Buffer.concat(chunks).toString();
  assert.ok(!output.includes('forbidden-partial-tool'));
  assert.match(output, /safe completion/);
  assert.equal(calls, 2);
});

function responseHistory(id, count = 105) {
  const input = [{ role: 'user', content: [{ type: 'input_text', text: `Pending objective ${id}; completed writes must not repeat.` }] }];
  for (let i = 0; i < count; i++) input.push({ type: 'reasoning', id: `${id}-reason-${i}`, summary: [], encrypted_content: 'offline-reasoning' }, { type: 'function_call', call_id: `${id}-call-${i}`, name: 'Read', arguments: '{}' }, { type: 'function_call_output', call_id: `${id}-call-${i}`, output: `completed ${id} ${i}` });
  return { model: 'offline-model', stream: true, store: false, instructions: 'Original permissions and model remain unchanged.', reasoning: { effort: 'high' }, tools: [{ type: 'function', name: 'Read', parameters: { type: 'object', properties: {} } }], input };
}
const responseAnswer = text => ({ id: 'resp_offline', object: 'response', status: 'completed', model: 'offline-model', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const responseStream = text => sse([{ type: 'response.created', response: { id: 'resp_offline', status: 'in_progress' } }, { type: 'response.output_text.delta', delta: text }, { type: 'response.completed', response: responseAnswer(text) }]);

test('HTTP gateway retries beyond its short burst budget until the upstream recovers', { timeout: 2000 }, async t => {
  let calls = 0;
  const upstream = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    if (++calls < 5) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'api_error' } })); }
    else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); }
  });
  const upstreamUrl = await listen(upstream);
  const { server, stats } = createRecoveryServer({ upstream: upstreamUrl, delays: [0], cooldownMs: 0, keepTrying: true });
  const gatewayUrl = await listen(server);
  t.after(async () => { await close(server); await close(upstream); });
  const response = await fetch(gatewayUrl + '/v1/messages', { method: 'POST', headers: auth, body: JSON.stringify(history('persistent-http', 1)) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls, 5);
  assert.equal(stats.retries, 4);
});

test('Responses checkpoint retains reasoning with the recent eight calls and all corresponding results', async t => {
  const stateDir = temporary(t);
  const body = responseHistory('responses-tools');
  const original = JSON.stringify(body);
  const boundary = responseRecoveryBoundary(body.input);
  assert.equal(body.input[boundary].type, 'reasoning');
  assert.equal(body.input.slice(boundary).filter(item => item.type === 'function_call').length, 8);
  assert.deepEqual(body.input.slice(0, boundary).filter(item => item.type === 'function_call').map(item => item.call_id), body.input.slice(0, boundary).filter(item => item.type === 'function_call_output').map(item => item.call_id));
  const sent = [];
  const recovery = createRecovery({ stateDir, delays: [], fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    sent.push(request);
    assert.equal(new URL(url).pathname, '/v1/responses');
    if (request.instructions?.startsWith('Summarize this historical coding transcript')) {
      assert.equal(request.tools, undefined);
      assert.equal(request.input.length, 1);
      return new Response(responseStream('Exact pending objective responses-tools, with completed writes preserved.'), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (request.input.filter(item => item.type === 'function_call').length >= 100) return limit();
    return new Response(responseStream('resumed responses-tools'), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const result = await recovery.recover('/v1/responses', body, { ...auth, session_id: 'responses-tools' }, new AbortController().signal);
  assert.equal(inspectSse(result.body).response.status, 'completed');
  assert.equal(JSON.stringify(body), original);
  const resumed = sent.at(-1);
  assert.deepEqual(resumed.input.slice(1), body.input.slice(boundary));
  assert.equal(resumed.input[0].content[0].type, 'input_text');
  for (const field of ['tools', 'model', 'instructions', 'reasoning', 'store']) assert.deepEqual(resumed[field], body[field]);
  const before = sent.length;
  await recovery.recover('/v1/responses', body, { ...auth, session_id: 'responses-tools' }, new AbortController().signal);
  assert.equal(sent.length, before + 1);
  assert.equal(recovery.stats.checkpoints, 1);
});

test('Responses HTTP requests recover separately for concurrent native sessions', async t => {
  const stateDir = temporary(t);
  const resumed = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString());
    if (request.instructions?.startsWith('Summarize this historical coding transcript')) {
      const id = request.input[0].content[0].text.includes('response-a') ? 'response-a' : 'response-b';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(responseStream(`Summary for ${id} only`));
    } else if (request.input.filter(item => item.type === 'function_call').length >= 100) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'session_turn_limit_exceeded', message: 'This conversation has reached 105 model turns.' } }));
    } else {
      resumed.push(request);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(responseStream(request.input[0].content[0].text));
    }
  });
  const upstreamUrl = await listen(upstream);
  const { server, stats } = createRecoveryServer({ upstream: upstreamUrl, stateDir, delays: [] });
  const gatewayUrl = await listen(server);
  t.after(async () => { await close(server); await close(upstream); });
  const results = await Promise.all(['response-a', 'response-b'].map(async id => {
    const response = await fetch(gatewayUrl + '/v1/responses', { method: 'POST', headers: { ...auth, session_id: id }, body: JSON.stringify(responseHistory(id)) });
    const output = await response.text();
    assert.match(output, new RegExp(`Summary for ${id} only`));
    assert.ok(!output.includes(id === 'response-a' ? 'Summary for response-b' : 'Summary for response-a'));
    return response.status;
  }));
  assert.deepEqual(results, [200, 200]);
  assert.equal(resumed.length, 2);
  assert.equal(stats.checkpoints, 2);
  assert.equal(fs.readdirSync(stateDir).filter(name => name.endsWith('.json')).length, 2);
});

test('HTTP 200 stream overload, rate limit and API errors retry before delivery', async () => {
  for (const type of ['overloaded_error', 'rate_limit_error', 'rate_limit_exceeded', 'api_error', 'upstream_error']) {
    let calls = 0;
    const recovery = createRecovery({ delays: [0], fetchImpl: async () => new Response(++calls === 1 ? sse([{ type: 'error', error: { type, message: 'offline transient' } }]) : complete('recovered'), { headers: { 'content-type': 'text/event-stream' } }) });
    const result = await recovery.recover('/v1/messages', history(type, 1), auth, new AbortController().signal);
    assert.equal(calls, 2);
    assert.equal(inspectSse(result.body).text, 'recovered');
  }
});

test('HTTP 200 rate_limit_exceeded codes retry Messages and Responses without changing requests', async () => {
  for (const responses of [false, true]) for (const streaming of [false, true]) for (const type of [undefined, 'error']) {
    const body = { ...(responses ? responseHistory('rate-limit-code') : history('rate-limit-code', 1)), stream: true };
    const original = JSON.stringify(body);
    const error = { ...(type ? { type } : {}), code: 'rate_limit_exceeded', message: 'private rate limit detail' };
    const sent = [];
    const logs = [];
    const recovery = createRecovery({ delays: [0], logger: entry => logs.push(entry), fetchImpl: async (url, options) => {
      sent.push(JSON.parse(options.body));
      assert.equal(new Headers(options.headers).get('x-api-key'), auth['x-api-key']);
      if (sent.length === 1) {
        if (!streaming) return Response.json({ type: 'error', error });
        const frame = responses ? { type: 'response.failed', response: { status: 'failed', error } } : { type: 'error', error };
        return new Response(sse([frame]), { headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(responses ? responseStream('resumed') : complete('resumed'), { headers: { 'content-type': 'text/event-stream' } });
    } });
    const result = await recovery.recover(responses ? '/v1/responses' : '/v1/messages', body, auth, new AbortController().signal);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1], sent[0]);
    assert.equal(JSON.stringify(body), original);
    assert.equal(inspectSse(result.body).text, 'resumed');
    assert.equal(recovery.stats.retries, 1);
    assert.equal(recovery.stats.checkpoints, 0);
    assert.equal(recovery.stats.summaryCalls, 0);
    assert.equal(logs.some(entry => entry.event === 'retry' && entry.code === 'rate_limit_exceeded'), true);
    assert.equal(JSON.stringify(logs).includes(error.message), false);
  }
});

test('rate limit aliases never override authentication, quota or permission failures', () => {
  for (const status of [400, 401, 403]) {
    assert.equal(isTransient(status, { error: { code: 'rate_limit_exceeded' } }), false);
    assert.equal(isTransient(status, { error: { type: 'rate_limit_exceeded' } }), false);
  }
  for (const status of [200, 429, 503]) for (const permanent of ['authentication_error', 'permission_denied', 'permission_error', 'client_not_allowed', 'insufficient_quota', 'credit_balance_too_low', 'model_not_found']) {
    assert.equal(isTransient(status, { error: { type: permanent, code: 'rate_limit_exceeded' } }), false);
    assert.equal(isTransient(status, { error: { type: 'rate_limit_exceeded', code: permanent } }), false);
  }
  assert.equal(isTransient(200, { error: { type: 'permission_error', code: 'client_not_allowed' } }), false);
});

test('Responses summary upstream_error retries the failed summary before resuming the task', async () => {
  const body = responseHistory('summary-upstream-error');
  let summaries = 0;
  let business = 0;
  const logs = [];
  const recovery = createRecovery({ keepTrying: true, delays: [0], logger: entry => logs.push(entry), fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    if (request.instructions?.startsWith('Summarize this historical coding transcript')) {
      if (++summaries === 1) return new Response(sse([{ type: 'response.failed', response: { status: 'failed', error: { code: 'upstream_error', message: 'private upstream detail' } } }]), { headers: { 'content-type': 'text/event-stream' } });
      return new Response(responseStream('Completed actions retained; pending work remains open.'), { headers: { 'content-type': 'text/event-stream' } });
    }
    business++;
    return request.input.length > 100 ? limit() : new Response(responseStream('continued'), { headers: { 'content-type': 'text/event-stream' } });
  } });
  assert.equal(inspectSse((await recovery.recover('/v1/responses', body, auth, new AbortController().signal)).body).text, 'continued');
  assert.equal(summaries, 2);
  assert.equal(business, 2);
  assert.equal(recovery.stats.retries, 1);
  assert.equal(recovery.stats.checkpoints, 1);
  assert.equal(logs.some(entry => entry.event === 'retry' && entry.code === 'upstream_error' && entry.summary === true), true);
  assert.equal(JSON.stringify(logs).includes('private upstream detail'), false);
  assert.equal(isTransient(400, { error: { code: 'upstream_error' } }), false);
  assert.equal(isTransient(200, { error: { code: 'invalid_api_key', type: 'upstream_error' } }), false);
});

test('large Unicode histories summarize in bounded UTF-8 chunks without truncating the archive', async () => {
  const body = history('large-archive');
  body.messages[0].content += '原始任务与权限😀'.repeat(70000);
  let summaries = 0;
  let originalSegments = 0;
  const recovery = createRecovery({ delays: [], fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    if (isSummary(request)) {
      summaries++;
      const input = request.messages[0].content;
      assert.ok(!input.includes('�'));
      assert.ok(Buffer.byteLength(input) < 132000);
      if (input.includes('Historical archive level 0')) originalSegments++;
      return answer('Pending original objective and existing permissions preserved; completed writes must not repeat.');
    }
    return request.messages.filter(message => message.role === 'assistant').length >= 100 ? limit() : answer('continued');
  } });
  const result = await recovery.recover('/v1/messages', body, auth, new AbortController().signal);
  assert.equal(result.status, 200);
  assert.ok(originalSegments > 10);
  assert.ok(summaries <= 64);
});

test('unsafe URL paths are rejected before forwarding any credentials', async t => {
  let calls = 0;
  const recovery = createRecovery({ delays: [], fetchImpl: async () => { calls++; return answer('must not be called'); } });
  for (const bad of ['/\\example.invalid/v1/messages', '//example.invalid/v1/messages']) await assert.rejects(recovery.recover(bad, history('unsafe', 1), auth, new AbortController().signal), { code: 'BAD_PATH' });
  assert.equal(calls, 0);
  const upstream = http.createServer((req, res) => { calls++; res.end('{}'); });
  const upstreamUrl = await listen(upstream);
  const { server } = createRecoveryServer({ upstream: upstreamUrl, delays: [] });
  const gatewayUrl = await listen(server);
  t.after(async () => { await close(server); await close(upstream); });
  await new Promise((resolve, reject) => {
    const request = http.request(gatewayUrl, { method: 'POST', path: '/\\example.invalid/v1/responses', headers: auth }, response => { response.resume(); response.on('end', resolve); });
    request.on('error', reject);
    request.end(JSON.stringify(responseHistory('unsafe')));
  });
  assert.equal(calls, 0);
});

test('persistent recovery survives an exhausted burst and nested network failures', async () => {
  let calls = 0;
  const logs = [];
  const recovery = createRecovery({ keepTrying: true, delays: [0], cooldownMs: 0, logger: value => logs.push(value), fetchImpl: async () => {
    if (++calls < 5) throw new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error('private-network-detail'), { code: 'ECONNRESET' })]) });
    return answer('continued after cooldown');
  } });
  const result = await recovery.recover('/v1/messages', history('persistent', 1), auth, new AbortController().signal);
  assert.equal(result.status, 200);
  assert.equal(calls, 5);
  assert.equal(logs.filter(value => value.event === 'waiting-upstream').length, 1);
  assert.equal(logs.find(value => value.event === 'retry').code, 'ECONNRESET');
  assert.ok(!JSON.stringify(logs).includes('private-network-detail'));
  assert.equal(recovery.stats.completed, 1);
});

test('human cancellation ends persistent cooldown immediately without reviving the request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const recovery = createRecovery({ keepTrying: true, delays: [], cooldownMs: 60000, logger: value => { if (value.event === 'waiting-upstream') controller.abort(new Error('human stopped task')); }, fetchImpl: async () => { calls++; return Response.json({ error: { type: 'api_error' } }, { status: 503 }); } });
  await assert.rejects(recovery.recover('/v1/messages', history('cancel-cooldown', 1), auth, controller.signal), /human stopped task/);
  assert.equal(calls, 1);
  assert.equal(recovery.stats.cancelled, 1);
  assert.equal(recovery.activity().length, 0);
});

test('quota and certificate errors do not enter persistent retries', async () => {
  assert.equal(isTransient(429, { error: { code: 'insufficient_quota' } }), false);
  const quota = createRecovery({ keepTrying: true, delays: [], fetchImpl: async () => Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }) });
  assert.equal((await quota.recover('/v1/messages', history('quota', 1), auth, new AbortController().signal)).status, 429);
  let calls = 0;
  const tls = createRecovery({ keepTrying: true, delays: [], fetchImpl: async () => { calls++; throw new TypeError('fetch failed', { cause: Object.assign(new Error('certificate'), { code: 'CERT_HAS_EXPIRED' }) }); } });
  await assert.rejects(tls.recover('/v1/messages', history('certificate', 1), auth, new AbortController().signal), /fetch failed/);
  assert.equal(calls, 1);
});

test('retry-after supports seconds and HTTP dates without exposing error messages', () => {
  const now = Date.parse('2026-11-27T08:00:00Z');
  assert.equal(retryAfterMs('15', now), 15000);
  assert.equal(retryAfterMs('Fri, 27 Nov 2026 08:01:00 GMT', now), 60000);
  assert.equal(retryAfterMs('invalid', now), 0);
  assert.equal(retryAfterMs('-2', now), 0);
  assert.deepEqual(failureDetails(new TypeError('credential must never enter diagnostics')), { code: 'TypeError', causes: ['TypeError'] });
});

test('redacted diagnostics retain error types and recognize wrapped text errors', () => {
  const secret = 'private-prompt-or-credential-sentinel';
  const details = failureDetails({ error: { type: 'invalid_request_error', param: 'reasoning', message: secret } });
  assert.deepEqual(details, { code: 'invalid_request_error', causes: ['invalid_request_error'], types: ['invalid_request_error'], parameter: 'reasoning', category: 'invalid_request' });
  assert.equal(JSON.stringify(details).includes(secret), false);
  assert.equal(failureDetails({ error: `wrapper ${JSON.stringify({ error: { code: 'context_length_exceeded', message: secret } })}` }).category, 'context_limit');
  assert.equal(failureDetails({ error: { type: 'invalid_request_error', param: secret, message: secret } }).parameter, undefined);
  assert.equal(isTurnLimit({ error: 'This conversation has reached 105 model turns.' }), true);
  assert.equal(isContextLimit('maximum context length exceeded'), true);
  assert.equal(isTransient(400, { error: 'bps_stream_error: Upstream request failed, please try again later.' }), true);
});

test('summary HTTP 400 diagnostics preserve type-only errors without retrying permanent requests', async () => {
  for (const structured of [true, false]) {
    const logs = [];
    let summaries = 0;
    let business = 0;
    const secret = 'private-summary-error-sentinel';
    const recovery = createRecovery({ keepTrying: true, delays: [], logger: entry => logs.push(entry), fetchImpl: async (url, options) => {
      if (isSummary(JSON.parse(options.body))) {
        summaries++;
        return structured ? Response.json({ error: { type: 'invalid_request_error', param: 'reasoning', message: secret } }, { status: 400 }) : new Response(secret, { status: 400 });
      }
      business++;
      return limit();
    } });
    await assert.rejects(recovery.recover('/v1/messages', history('summary-400'), auth, new AbortController().signal), { code: 'SUMMARY_FAILED' });
    const failure = logs.find(entry => entry.event === 'summary-invalid');
    assert.equal(failure.status, 400);
    assert.equal(failure.code, structured ? 'invalid_request_error' : 'UNKNOWN_ERROR');
    assert.equal(failure.parameter, structured ? 'reasoning' : undefined);
    assert.equal(JSON.stringify(logs).includes(secret), false);
    assert.equal(summaries, 1);
    assert.equal(business, 1);
    assert.equal(recovery.stats.checkpoints, 0);
  }
});

test('plain-text turn-limit errors recover the history instead of ending the task', async () => {
  const body = history('text-turn-limit');
  const recovery = createRecovery({ delays: [], fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    if (isSummary(request)) return answer('Completed reads retained; pending objective remains open.');
    return request.messages.length > 100 ? new Response('This conversation has reached 105 model turns.', { status: 400 }) : answer('continued');
  } });
  assert.equal((await recovery.recover('/v1/messages', body, auth, new AbortController().signal)).status, 200);
  assert.equal(recovery.stats.checkpoints, 1);
});

test('context-window errors compact the exact closed prefix and keep current tools', async () => {
  const body = history('context-recovery', 20);
  const original = JSON.stringify(body);
  let resumed;
  assert.equal(isContextLimit({ error: { code: 'context_length_exceeded' } }), true);
  assert.equal(isContextLimit({ content: 'maximum context length' }), false);
  const recovery = createRecovery({ delays: [], fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    if (isSummary(request)) return answer('Pending context objective, previous completed results retained.');
    if (request.messages.length > 20) return Response.json({ error: { code: 'context_length_exceeded' } }, { status: 400 });
    resumed = request;
    return answer('context resumed');
  } });
  assert.equal((await recovery.recover('/v1/messages', body, auth, new AbortController().signal)).status, 200);
  assert.equal(JSON.stringify(body), original);
  assert.deepEqual(resumed.tools, body.tools);
  assert.deepEqual(resumed.messages.slice(1), body.messages.slice(-16));
});

test('completed summary segments survive cancellation and a new gateway process', async t => {
  const stateDir = temporary(t);
  const body = history('segment-resume');
  body.messages[0].content += 'preserve-original-objective '.repeat(24000);
  const controller = new AbortController();
  let firstCalls = 0;
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body);
    if (isSummary(request)) return answer('Durable segment with pending objective and original permissions.');
    return request.messages.length > 100 ? limit() : answer('resumed after segment checkpoint');
  };
  const first = createRecovery({ stateDir, delays: [], fetchImpl: async (url, options) => {
    if (isSummary(JSON.parse(options.body)) && ++firstCalls === 3) { controller.abort(new Error('caller disconnect')); throw controller.signal.reason; }
    return fetchImpl(url, options);
  } });
  await assert.rejects(first.recover('/v1/messages', body, auth, controller.signal), /caller disconnect/);
  assert.equal(fs.readdirSync(stateDir).filter(name => name.endsWith('.json')).length, 0);
  const progress = fs.readdirSync(stateDir).find(name => name.endsWith('.progress.jsonl'));
  assert.ok(progress);
  fs.appendFileSync(path.join(stateDir, progress), '{torn-record');
  const logs = [];
  const next = createRecovery({ stateDir, delays: [], logger: value => logs.push(value), fetchImpl });
  const result = await next.recover('/v1/messages', body, auth, new AbortController().signal);
  assert.equal(result.status, 200);
  assert.equal(next.stats.summaryReused, 2);
  assert.equal(logs.filter(value => value.event === 'summary-progress' && value.reused).length, 2);
  assert.equal(fs.readdirSync(stateDir).filter(name => name.endsWith('.json')).length, 1);
  assert.equal(fs.readdirSync(stateDir).filter(name => name.endsWith('.progress.jsonl')).length, 0);
});

test('same-session overlapping recovery shares one checkpoint without crossing cancellation', async t => {
  const stateDir = temporary(t);
  const body = history('same-session');
  let release;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let summaries = 0;
  const recovery = createRecovery({ stateDir, delays: [], fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    if (isSummary(request)) { summaries++; entered(); await pending; return answer('One shared exact checkpoint.'); }
    return request.messages.length > 100 ? limit() : answer('continued');
  } });
  const first = recovery.recover('/v1/messages', body, auth, new AbortController().signal);
  await ready;
  const cancelled = new AbortController();
  const waiter = recovery.recover('/v1/messages', body, auth, cancelled.signal);
  const caught = assert.rejects(waiter, /waiter stopped/);
  await new Promise(resolve => setImmediate(resolve));
  cancelled.abort(new Error('waiter stopped'));
  const third = recovery.recover('/v1/messages', body, auth, new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(summaries, 1);
  release();
  const results = await Promise.all([first, third]);
  await caught;
  assert.deepEqual(results.map(value => value.status), [200, 200]);
  assert.equal(summaries, 1);
  assert.equal(recovery.stats.checkpoints, 1);
});

test('Responses reasoning-token truncation retries only the summary with a larger budget', async () => {
  const body = responseHistory('token-resume');
  const budgets = [];
  const recovery = createRecovery({ delays: [], fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    if (request.instructions?.startsWith('Summarize this historical coding transcript')) {
      budgets.push(request.max_output_tokens);
      if (budgets.length === 1) return new Response(sse([{ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } }]), { headers: { 'content-type': 'text/event-stream' } });
      return new Response(responseStream('Validated checkpoint, no truncated text included.'), { headers: { 'content-type': 'text/event-stream' } });
    }
    return request.input.length > 100 ? limit() : new Response(responseStream('continued'), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const result = await recovery.recover('/v1/responses', body, { ...auth, session_id: 'token-resume' }, new AbortController().signal);
  assert.equal(inspectSse(result.body).complete, true);
  assert.deepEqual(budgets, [4096, 8192]);
  assert.equal(recovery.stats.checkpoints, 1);
});

test('incomplete Responses streams are retried rather than delivered', async () => {
  let calls = 0;
  const recovery = createRecovery({ delays: [0], fetchImpl: async () => new Response(
    ++calls === 1
      ? sse([{ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] } }])
      : responseStream('complete after retry'),
    { headers: { 'content-type': 'text/event-stream' } }
  ) });
  const result = await recovery.recover('/v1/responses', responseHistory('incomplete-retry', 1), auth, new AbortController().signal);
  assert.equal(inspectSse(result.body).complete, true);
  assert.equal(calls, 2);
});

test('persistent transport retries do not consume the logical summary-call budget', async () => {
  let failed = 0;
  const recovery = createRecovery({ keepTrying: true, delays: [], cooldownMs: 0, fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    if (isSummary(request)) {
      if (++failed <= 66) throw Object.assign(new Error('offline network reset'), { code: 'ECONNRESET' });
      return answer('Completed after transport became available.');
    }
    return request.messages.length > 100 ? limit() : answer('continued');
  } });
  assert.equal((await recovery.recover('/v1/messages', history('long-outage'), auth, new AbortController().signal)).status, 200);
  assert.equal(failed, 67);
  assert.equal(recovery.stats.checkpoints, 1);
});

test('DONE markers are accepted only after a semantic completion event', () => {
  assert.equal(inspectSse(complete('done') + 'data: [DONE]\n\n').complete, true);
  assert.equal(inspectSse('data: [DONE]\n\n').complete, false);
});

test('semantic completion releases an open HTTP body and preserves split UTF-8 frames', { timeout: 2000 }, async () => {
  for (const protocol of ['messages', 'responses']) {
    let cancelled = 0;
    const text = '跨块字符仍保持完整';
    const payload = Buffer.from(protocol === 'messages' ? complete(text) : responseStream(text));
    const recovery = createRecovery({ delays: [], fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { for (let i = 0; i < payload.length; i += 7) controller.enqueue(payload.subarray(i, i + 7)); },
      cancel() { cancelled++; }
    }), { headers: { 'content-type': 'text/event-stream' } }) });
    const result = await recovery.recover('/v1/' + protocol, protocol === 'messages' ? history('open-body', 1) : responseHistory('open-body', 1), auth, new AbortController().signal);
    assert.equal(inspectSse(result.body).text, text);
    assert.equal(cancelled, 1);
    assert.equal(recovery.stats.completed, 1);
  }
});

test('an open stream error is released and retried before any tool reaches the caller', { timeout: 2000 }, async () => {
  let calls = 0;
  let cancelled = 0;
  const recovery = createRecovery({ delays: [0], fetchImpl: async () => {
    const payload = ++calls === 1 ? sse([{ type: 'error', error: { type: 'overloaded_error' } }]) : complete('one completed response');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(payload)); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const result = await recovery.recover('/v1/messages', history('open-error', 1), auth, new AbortController().signal);
  assert.equal(inspectSse(result.body).text, 'one completed response');
  assert.equal(calls, 2);
  assert.equal(cancelled, 2);
});
