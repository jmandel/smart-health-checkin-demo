import React, { useState, useEffect, type ReactNode } from 'react';
import { request, maybeHandleReturn, type DCQLQuery, type RehydratedResponse } from 'smart-health-checkin';

// In production, set this to your relay's URL.
// For local testing, override via the build or query param.
const VERIFIER_BASE = new URLSearchParams(location.search).get('verifier')
  || 'https://smart-health-checkin.exe.xyz';
const CHECKIN_BASE = VERIFIER_BASE + '/checkin';

const dcqlQuery: DCQLQuery = {
  credentials: [
    {
      id: 'coverage-1', format: 'smart_artifact', require_cryptographic_holder_binding: false,
      meta: { profile: 'http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage' }
    },
    {
      id: 'patient-1', format: 'smart_artifact', require_cryptographic_holder_binding: false,
      meta: { profile: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient' }
    }
  ],
  credential_sets: [
    { options: [['coverage-1']], required: false },
    { options: [['patient-1']], required: false }
  ]
};

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function CollapsibleJson({ title, data }: { title: string; data: object | null }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ padding: '10px 15px', background: '#0f172a', borderRadius: open ? '8px 8px 0 0' : 8, fontWeight: 600, color: '#94a3b8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ marginRight: 8, fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        {title}
      </div>
      {open && (
        <pre style={{ margin: 0, padding: 15, background: '#1e293b', borderRadius: '0 0 8px 8px', overflow: 'auto', fontFamily: 'monospace', fontSize: 11, color: '#e2e8f0', maxHeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ResultCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

export default function App() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RehydratedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestInfo, setRequestInfo] = useState<object | null>(null);

  useEffect(() => { maybeHandleReturn(); }, []);

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await request(dcqlQuery, {
        walletUrl: CHECKIN_BASE,
        wellKnownClientUrl: VERIFIER_BASE,
        flow: 'same-device',
        onRequestStart: (info) => setRequestInfo(info),
      }) as RehydratedResponse;
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <header style={{ background: 'linear-gradient(135deg, #166534 0%, #15803d 100%)', color: 'white', padding: 24 }}>
        <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 50, height: 50, background: 'rgba(255,255,255,0.2)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 20 }}>CH</div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Community Health Center</h2>
        </div>
      </header>

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '32px 16px' }}>
        <div style={{ background: 'white', borderRadius: 16, padding: 40, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h1 style={{ margin: '0 0 8px 0', fontSize: 28 }}>Patient Check-in</h1>
          <p style={{ color: '#64748b', margin: '0 0 24px 0' }}>Share your health records to complete registration</p>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 24, fontSize: 14, lineHeight: 1.8, color: '#475569' }}>
            <strong style={{ color: '#1e293b' }}>SMART Health Check-in</strong> is an open protocol for browser-based health data sharing.
            It uses <a href="https://openid.net/specs/openid-4-verifiable-presentations-1_0.html" style={{ color: '#166534' }}>OpenID for Verifiable Presentations</a> with
            end-to-end encryption, signed request objects, and support for same-device and cross-device flows.
            <br /><br />
            This page is a <strong>standalone static app</strong> on a separate domain, demonstrating that any site can
            participate in the protocol by pointing at a shared verifier relay. The verifier identity shown to your
            health app comes from <code>{VERIFIER_BASE}</code>, not from this page's domain.
            <br /><br />
            <a href="https://smart-health-checkin.exe.xyz/" style={{ color: '#166534', fontWeight: 500 }}>Full demo experience</a>
            {' | '}
            <a href="https://github.com/jmandel/smart-health-checkin-demo" style={{ color: '#166534', fontWeight: 500 }}>GitHub</a>
          </div>

          {!result && !error && (
            <button
              onClick={handleStart}
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', padding: '20px 24px', background: '#166534', color: 'white', border: 'none', borderRadius: 12, fontSize: 16, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, textAlign: 'left' }}
            >
              {loading ? (
                <span>Opening check-in...</span>
              ) : (
                <>
                  <span style={{ fontSize: 28 }}>🛡️</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 17 }}>Share with SMART Health Check-in</div>
                    <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>Connect your health app to auto-fill your records</div>
                  </div>
                </>
              )}
            </button>
          )}

          {result && (
            <>
              <div style={{ background: '#f0fdf4', color: '#166534', padding: 16, borderRadius: 8, fontWeight: 600, marginBottom: 12 }}>
                ✓ Health records received!
              </div>
              {result.credentials && Object.values(result.credentials).flat().map((cred: any, i) => {
                if (cred.resourceType === 'Coverage') {
                  return (
                    <ResultCard key={i} title="Insurance Coverage">
                      <Field label="Member ID" value={cred.subscriberId} />
                      <Field label="Payor" value={cred.payor?.[0]?.display} />
                    </ResultCard>
                  );
                }
                if (cred.resourceType === 'Patient') {
                  return (
                    <ResultCard key={i} title="Patient">
                      <Field label="Name" value={cred.name?.[0]?.text} />
                      <Field label="DOB" value={cred.birthDate} />
                    </ResultCard>
                  );
                }
                return (
                  <ResultCard key={i} title={cred.resourceType || 'Resource'}>
                    <pre style={{ fontSize: 11, margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(cred, null, 2)}</pre>
                  </ResultCard>
                );
              })}
            </>
          )}

          {error && (
            <div style={{ background: '#fef2f2', color: '#991b1b', padding: '12px 16px', borderRadius: 8, marginTop: 16 }}>
              Error: {error}
            </div>
          )}

          <CollapsibleJson title="Bootstrap Request (sent to wallet/picker)" data={(requestInfo as any)?.bootstrap || null} />
          <CollapsibleJson title="Shim Transaction (internal)" data={(requestInfo as any)?.transaction || null} />
          <CollapsibleJson title="Wire Response (vp_token)" data={result ? { state: result.state, vp_token: result.vp_token } : null} />
          <CollapsibleJson title="Full Response" data={result} />
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '32px 16px', color: '#94a3b8', fontSize: 13 }}>
        Example of a third-party static site using the{' '}
        <a href="https://github.com/jmandel/smart-health-checkin-demo" style={{ color: '#166534' }}>SMART Health Check-in</a> protocol.
      </div>
    </>
  );
}
