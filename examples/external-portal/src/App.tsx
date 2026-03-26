import React, { useState, useEffect } from 'react';
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
  const [debugOpen, setDebugOpen] = useState(false);
  const [requestInfo, setRequestInfo] = useState<object | null>(null);

  useEffect(() => { maybeHandleReturn(); }, []);

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await request(dcqlQuery, {
        checkinBase: CHECKIN_BASE,
        verifierBase: VERIFIER_BASE,
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

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 16, marginBottom: 24, fontSize: 14, lineHeight: 1.6, color: '#166534' }}>
            <strong>Cross-origin demo:</strong> This app is a standalone static site.
            It uses the SMART Health Check-in shim to talk to a shared verifier relay at <code>{VERIFIER_BASE}</code>.
            The verifier identity shown to your health app comes from that server, not from this page's domain.
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

          <div style={{ marginTop: 24 }}>
            <div
              onClick={() => setDebugOpen(!debugOpen)}
              style={{ fontSize: 13, color: '#64748b', cursor: 'pointer', userSelect: 'none' }}
            >
              {debugOpen ? '▾' : '▸'} Protocol details
            </div>
            {debugOpen && requestInfo && (
              <pre style={{ background: '#1e293b', color: '#e2e8f0', padding: 12, borderRadius: 8, fontSize: 11, overflow: 'auto', marginTop: 8 }}>
                {JSON.stringify(requestInfo, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '32px 16px', color: '#94a3b8', fontSize: 13 }}>
        Example of a third-party static site using the{' '}
        <a href="https://github.com/jmandel/smart-health-checkin-demo" style={{ color: '#166534' }}>SMART Health Check-in</a> protocol.
      </div>
    </>
  );
}
