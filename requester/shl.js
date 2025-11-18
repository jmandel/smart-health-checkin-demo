/**
 * SHL Share Picker - Client Library
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

  /**
   * Initiate a credential request (Navigator Credentials API compatible)
   * @param {Object} credentialRequest - { digital: { requests: [{ protocol, data }] } }
   * @param {Object} opts - Options { checkinBase }
   * @returns {Promise<Object>} - { type, protocol, data }
   */
  async function request(credentialRequest, opts) {
    if (!credentialRequest?.digital?.requests?.[0]) {
      throw new Error('digital.requests[0] required');
    }

    const checkinBase = (opts?.checkinBase || opts?.gatewayBase || '').replace(/\/+$/, '');
    if (!checkinBase) throw new Error('checkinBase required');

    const state = rand();
    const returnUrl = location.origin + location.pathname;

    // Extract protocol from first request for return value compatibility
    const protocol = credentialRequest.digital.requests[0].protocol;

    console.log('[SHL] Initiating request:', { credentialRequest, state, returnUrl });

    // Prepare listeners BEFORE opening popup
    const chan = new BroadcastChannel('shl-' + state);
    let pop;

    const done = new Promise((resolve, reject) => {
      const timeout = 2 * 60 * 1000; // 2 minutes
      const to = setTimeout(() => {
        cleanup();
        reject(new Error('Request timeout after 2 minutes'));
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

          const plaintext = JSON.stringify(ret.payload);

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
            console.log('[SHL] Closing app picker popup');
            pop.close();
          }
        } catch (e) {
          console.warn('[SHL] Could not close popup:', e);
        }
      }
    });

    // Open app picker - pass through the digital credential request structure
    const reqEnvelope = encJ({
      v: 1,
      state,
      returnUrl,
      digital: credentialRequest.digital
    });

    const url = `${checkinBase}/#req=${encodeURIComponent(reqEnvelope)}`;
    console.log('[SHL] Opening check-in:', url);

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
    const res = p.get('res');
    if (!res) return false;

    console.log('[SHL] Detected return context');

    try {
      const ret = decJ(res);
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
