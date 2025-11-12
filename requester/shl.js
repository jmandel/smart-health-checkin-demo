/**
 * Zero-Trust Web Rails (ZTWR) - Client Library
 * A minimalist, static, cross-platform flow for secure credential sharing
 */
(() => {
  const te = new TextEncoder(), td = new TextDecoder();

  // Base64url encoding/decoding utilities
  const b64u = (buf) => {
    const bin = String.fromCharCode(...new Uint8Array(buf));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const ub64 = (s) => {
    const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a.buffer;
  };

  const encJ = (o) => b64u(te.encode(JSON.stringify(o)));
  const decJ = (s) => JSON.parse(td.decode(ub64(s)));

  // Generate random state (128-bit hex)
  const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // OPTIONAL E2E encryption functions (commented for minimal version)
  /*
  async function genECDH() {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    return {
      kp,
      pub: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }
    };
  }

  async function decryptJWE(jwe, privKey, state) {
    const epk = await crypto.subtle.importKey(
      'jwk',
      jwe.epk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );
    const aes = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: epk },
      privKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const iv = new Uint8Array(ub64(jwe.iv));
    const aad = te.encode(state);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      aes,
      ub64(jwe.ciphertext)
    );
    return td.decode(pt);
  }
  */

  /**
   * Initiate a credential request (Navigator Credentials API compatible)
   * @param {Object} credentialRequest - { digital: { requests: [{ protocol, data }] } }
   * @param {Object} opts - Options { gatewayBase }
   * @returns {Promise<Object>} - { type, protocol, data }
   */
  async function request(credentialRequest, opts) {
    if (!credentialRequest?.digital?.requests?.[0]) {
      throw new Error('digital.requests[0] required');
    }

    const gatewayBase = (opts?.gatewayBase || '').replace(/\/+$/, '');
    if (!gatewayBase) throw new Error('gatewayBase required');

    const state = rand();
    const returnUrl = location.origin + location.pathname;

    // Extract protocol from first request for return value compatibility
    const protocol = credentialRequest.digital.requests[0].protocol;

    console.log('[SHL] Initiating request:', { credentialRequest, state, returnUrl });

    // OPTIONAL E2E (commented to keep minimal)
    // const { kp, pub } = await genECDH();

    // Prepare listeners BEFORE opening popup
    const chan = new BroadcastChannel('shl-' + state);
    let pop;

    const done = new Promise((resolve, reject) => {
      const timeout = 5 * 60 * 1000; // 5 minutes
      const to = setTimeout(() => {
        cleanup();
        reject(new Error('Request timeout after 5 minutes'));
      }, timeout);

      chan.onmessage = async (ev) => {
        const msg = ev.data;
        console.log('[SHL] Received message on channel:', msg);

        if (!msg || msg.state !== state || !msg.res) return;

        try {
          const ret = decJ(msg.res);
          if (ret.state !== state) {
            console.warn('[SHL] State mismatch');
            return;
          }

          // If E2E encryption enabled:
          // const plaintext = ret.jwe
          //   ? await decryptJWE(ret.jwe, kp.privateKey, state)
          //   : JSON.stringify(ret.payload);

          const plaintext = JSON.stringify(ret.payload); // minimal (no E2E)

          console.log('[SHL] Request successful!');
          cleanup();
          resolve({
            type: 'digital_credential',
            protocol,
            data: plaintext
          });
        } catch (e) {
          console.error('[SHL] Error processing response:', e);
          cleanup();
          reject(e);
        }
      };

      function cleanup() {
        clearTimeout(to);
        chan.close();
        try {
          if (pop && !pop.closed) {
            console.log('[SHL] Closing gateway popup');
            pop.close();
          }
        } catch (e) {
          console.warn('[SHL] Could not close popup:', e);
        }
      }
    });

    // Open top-level gateway - pass through the digital credential request structure
    const reqEnvelope = encJ({
      v: 1,
      state,
      returnUrl,
      digital: credentialRequest.digital
      // recip_pub: pub  // if E2E enabled
    });

    const url = `${gatewayBase}/#req=${encodeURIComponent(reqEnvelope)}`;
    console.log('[SHL] Opening gateway:', url);

    pop = window.open(url, '_blank');
    if (!pop) {
      chan.close();
      throw new Error('Popup blocked - please allow popups for this site');
    }

    return done;
  }

  /**
   * Auto-detect and handle return context
   * Call this on page load to handle return flow
   * @returns {Promise<boolean>} - true if this was a return context
   */
  async function maybeHandleReturn() {
    const h = location.hash.slice(1);
    if (!h) return false;

    const p = new URLSearchParams(h);
    const res = p.get('res'); // base64url(JSON) blob
    if (!res) return false;

    console.log('[SHL] Detected return context');

    try {
      const ret = decJ(res); // { v, state, payload | jwe }
      if (!ret?.state) {
        console.warn('[SHL] Return data missing state');
        return false;
      }

      console.log('[SHL] Broadcasting result to original tab, state:', ret.state);

      const bc = new BroadcastChannel('shl-' + ret.state);
      bc.postMessage({ state: ret.state, res });
      bc.close();

      // Show user-friendly message
      document.body.innerHTML = `
        <div style="font-family:system-ui;padding:40px;text-align:center;background:#0f141c;color:#e9eef5;min-height:100vh">
          <h1 style="color:#4ade80">✓ Success</h1>
          <p>Data shared successfully. This tab will close automatically.</p>
          <p style="color:#94a3b8;font-size:14px">If it doesn't close, you can safely close it manually.</p>
        </div>
      `;

      // Attempt to close self
      try {
        window.close();
      } catch (e) {
        console.log('[SHL] Could not auto-close (expected in some browsers)');
      }

      return true;
    } catch (e) {
      console.error('[SHL] Error handling return:', e);
      return false;
    }
  }

  // Export API
  window.SHL = { request, maybeHandleReturn };
  console.log('[SHL] Library loaded');
})();
