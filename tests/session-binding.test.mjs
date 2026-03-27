import { chromium } from 'playwright';

const VERIFIER = 'http://requester.localhost:3000';

async function main() {
  // Start servers
  console.log('Starting servers...');
  const { spawn } = await import('child_process');

  const procs = [];
  const startServer = (cmd, args, env = {}) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: 'ignore' });
    procs.push(p);
    return p;
  };

  startServer('bun', ['demo/serve-demo.ts'], {
    VERIFIER_BASE: VERIFIER,
    STATIC_DIR: 'build/smart-health-checkin-demo',
    PORT: '3000',
  });

  await new Promise(r => setTimeout(r, 2000));

  const results = [];
  function test(name, passed) {
    results.push({ name, passed });
    console.log(`${passed ? '  ✅' : '  ❌'} ${name}`);
  }

  try {
    // ================================================================
    console.log('\n=== Cross-device init WITHOUT session cookie ===');
    // ================================================================
    {
      const resp = await fetch(`${VERIFIER}/oid4vp/cross-device/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ephemeral_pub_jwk: { kty: 'EC', crv: 'P-256', x: 'test', y: 'test' },
          dcql_query: { credentials: [] },
        }),
      });
      test('cross-device init rejected without cookie', resp.status === 403);
      const body = await resp.json();
      test('error is verifier_session_required', body.error === 'verifier_session_required');
    }

    // ================================================================
    console.log('\n=== Staff login ===');
    // ================================================================
    let sessionCookie;
    {
      const resp = await fetch(`${VERIFIER}/demo/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nurse', password: 'demo' }),
      });
      test('login succeeds', resp.status === 200);
      const setCookie = resp.headers.get('set-cookie') || '';
      sessionCookie = setCookie.match(/staff_session=([a-f0-9]+)/)?.[0];
      test('session cookie returned', !!sessionCookie);
    }

    // ================================================================
    console.log('\n=== Cross-device init WITH session cookie ===');
    // ================================================================
    let txn;
    {
      const resp = await fetch(`${VERIFIER}/oid4vp/cross-device/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': sessionCookie,
        },
        body: JSON.stringify({
          ephemeral_pub_jwk: { kty: 'EC', crv: 'P-256', x: 'test', y: 'test' },
          dcql_query: { credentials: [] },
        }),
      });
      test('cross-device init succeeds with cookie', resp.status === 200);
      txn = await resp.json();
      test('transaction_id returned', !!txn.transaction_id);
      test('request_id returned', !!txn.request_id);
      test('read_secret returned', !!txn.read_secret);
    }

    // ================================================================
    console.log('\n=== Cross-device results WITHOUT session cookie ===');
    // ================================================================
    {
      const resp = await fetch(`${VERIFIER}/oid4vp/cross-device/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: txn.transaction_id,
          read_secret: txn.read_secret,
        }),
      });
      test('cross-device results rejected without cookie', resp.status === 403);
    }

    // ================================================================
    console.log('\n=== Cross-device results with WRONG session ===');
    // ================================================================
    {
      // Login as a different user to get a different session
      const loginResp = await fetch(`${VERIFIER}/demo/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'attacker', password: 'demo' }),
      });
      const otherCookie = (loginResp.headers.get('set-cookie') || '').match(/staff_session=([a-f0-9]+)/)?.[0];

      const resp = await fetch(`${VERIFIER}/oid4vp/cross-device/results`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': otherCookie,
        },
        body: JSON.stringify({
          transaction_id: txn.transaction_id,
          read_secret: txn.read_secret,
        }),
      });
      test('cross-device results rejected with wrong session', resp.status === 403);
      const body = await resp.json();
      test('error is session_mismatch', body.error === 'session_mismatch');
    }

    // ================================================================
    console.log('\n=== Cross-device results with CORRECT session ===');
    // ================================================================
    {
      // Post a fake JWE to the write endpoint first
      const writeResp = await fetch(`${VERIFIER}/oid4vp/responses/${txn.request_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'response=fake-jwe-for-testing',
      });

      // Hmm, write_token != request_id. We need the write_token from the signed request object.
      // Let's just fetch it from the request endpoint.
      const reqResp = await fetch(`${VERIFIER}/oid4vp/requests/${txn.request_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const jwt = await reqResp.text();
      // Decode the JWT payload (it's base64url, not encrypted)
      const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      const writeToken = payload.response_uri.split('/').pop();

      // Now post to the correct write endpoint
      const postResp = await fetch(`${VERIFIER}/oid4vp/responses/${writeToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'response=fake-jwe-for-testing',
      });
      test('wallet POST to response_uri succeeds', postResp.status === 200);

      // Now fetch with correct session
      const resp = await fetch(`${VERIFIER}/oid4vp/cross-device/results`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': sessionCookie,
        },
        body: JSON.stringify({
          transaction_id: txn.transaction_id,
          read_secret: txn.read_secret,
        }),
      });
      test('cross-device results succeed with correct session', resp.status === 200);
      const body = await resp.json();
      test('status is complete', body.status === 'complete');
      test('response contains posted JWE', body.response === 'fake-jwe-for-testing');
    }

    // ================================================================
    console.log('\n=== Same-device init works WITHOUT session ===');
    // ================================================================
    {
      const resp = await fetch(`${VERIFIER}/oid4vp/same-device/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uri: `${VERIFIER}/portal/`,
          ephemeral_pub_jwk: { kty: 'EC', crv: 'P-256', x: 'test', y: 'test' },
          dcql_query: { credentials: [] },
        }),
      });
      test('same-device init works without cookie (no session needed)', resp.status === 200);
    }

    // ================================================================
    console.log('\n=== request_id alone cannot fetch results ===');
    // ================================================================
    {
      // Try to use request_id as transaction_id (it's public, an attacker would know it)
      const resp = await fetch(`${VERIFIER}/oid4vp/cross-device/results`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': sessionCookie,
        },
        body: JSON.stringify({
          transaction_id: txn.request_id, // WRONG: using public request_id
          read_secret: txn.read_secret,
        }),
      });
      test('request_id cannot be used as transaction_id', resp.status === 404);
    }

    // ================================================================
    // Summary
    // ================================================================
    console.log('\n' + '='.repeat(50));
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    if (passed === total) {
      console.log(`✅ ALL ${total} TESTS PASSED`);
    } else {
      console.log(`❌ ${passed}/${total} passed, ${total - passed} FAILED`);
      process.exitCode = 1;
    }

  } finally {
    for (const p of procs) p.kill();
  }
}

main();
