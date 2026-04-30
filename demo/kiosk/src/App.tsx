import React, { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { type DCQLQuery } from 'smart-health-checkin';
import { config } from '../../config';
import { useDemoRequest } from '../../shared/useDemoRequest';
import { TransactionBrowser } from '../../shared/TransactionBrowser';
import { migraineQuestionnaire } from '../../shared/migraineQuestionnaire';
import { C4DIC_COVERAGE_PROFILE, SBC_INSURANCE_PLAN_PROFILE } from '../../shared/carinInsuranceExamples';
import { CLINICAL_HISTORY_PROFILES } from '../../shared/clinicalHistoryExamples';
import './styles.css';

const dcqlQuery: DCQLQuery = {
  credentials: [
    {
      id: 'coverage-1', format: 'smart_artifact', require_cryptographic_holder_binding: false,
      meta: { profile: C4DIC_COVERAGE_PROFILE }
    },
    {
      id: 'sbc-insurance-plan-1', format: 'smart_artifact', require_cryptographic_holder_binding: false,
      meta: { profile: SBC_INSURANCE_PLAN_PROFILE }
    },
    {
      id: 'clinical-history-1', format: 'smart_artifact', require_cryptographic_holder_binding: false,
      meta: { profiles: [...CLINICAL_HISTORY_PROFILES] }
    },
    {
      id: 'migraine-questionnaire-1', format: 'smart_artifact', require_cryptographic_holder_binding: false,
      meta: { questionnaire: migraineQuestionnaire }
    }
  ],
  credential_sets: [
    { options: [['coverage-1']], required: false },
    { options: [['sbc-insurance-plan-1']], required: false },
    { options: [['clinical-history-1']], required: false },
    { options: [['migraine-questionnaire-1']], required: false }
  ]
};

// ============================================================================
// Login gate
// ============================================================================

function hasSessionCookie(): boolean {
  return document.cookie.includes('staff_session=');
}

function StaffLogin({ onLogin }: { onLogin: (name: string) => void }) {
  const [username, setUsername] = useState('frontdesk');
  const [password, setPassword] = useState('demo');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const resp = await fetch('/demo/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'same-origin',
    });

    if (resp.ok) {
      const data = await resp.json() as { username: string };
      onLogin(data.username);
    } else {
      setError('Invalid credentials');
      setSubmitting(false);
    }
  };

  return (
    <div className="login-panel">
      <h2>Staff Sign-in</h2>
      <p className="login-hint">This simulates clinic staff authentication. The session cookie binds cross-device transactions to this workstation.</p>
      <form onSubmit={handleSubmit}>
        <label>
          Username
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button type="submit" disabled={submitting} className="start-button">
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// QR panel
// ============================================================================

function QRPanel({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && url) {
      QRCode.toCanvas(canvasRef.current, url, { width: 280, margin: 2 });
    }
  }, [url]);

  return (
    <div className="qr-panel">
      <canvas ref={canvasRef} />
      <p className="qr-instruction">Scan with patient's phone or share the link</p>
      <div className="qr-link-row">
        <input type="text" readOnly value={url} className="qr-link-input" />
        <button onClick={() => navigator.clipboard.writeText(url)} className="qr-copy-btn">Copy</button>
        <button onClick={() => window.open(url, '_blank')} className="qr-copy-btn">Open</button>
      </div>
    </div>
  );
}

// ============================================================================
// Main app
// ============================================================================

export default function App() {
  const [staffName, setStaffName] = useState<string | null>(
    hasSessionCookie() ? 'Staff' : null
  );

  const demo = useDemoRequest(dcqlQuery, {
    walletUrl: config.kiosk.walletUrl,
    wellKnownClientUrl: config.wellKnownClientUrl,
    flow: 'cross-device',
  });

  // Auto-start after login
  const started = useRef(false);
  useEffect(() => {
    if (staffName && !started.current) {
      started.current = true;
      demo.start();
    }
  }, [staffName]);

  let receivedCount = 0;
  if (demo.result?.credentials) {
    for (const items of Object.values(demo.result.credentials)) {
      receivedCount += (items as unknown[]).length;
    }
  }

  return (
    <>
      <header>
        <div className="header-content">
          <div className="logo">DM</div>
          <h2 className="clinic-name">Dr. Mandel's Family Medicine</h2>
          <span className="header-badge">
            {staffName ? `Staff: ${staffName}` : 'Front Desk'}
          </span>
        </div>
      </header>

      <div className="container">
        <div className="card">
          <div className="flow-badge">Cross-Device Flow</div>
          <h1>Front Desk Check-in</h1>
          <p className="subtitle">Start a check-in for a patient using their phone</p>

          {!staffName && (
            <StaffLogin onLogin={(name) => setStaffName(name)} />
          )}

          {staffName && demo.loading && demo.requestInfo && (
            <div className="waiting-panel">
              <QRPanel url={demo.requestInfo.launch_url} />
              <div className="waiting-status">
                <span className="loader" />
                <span>Waiting for patient to complete check-in on their device...</span>
              </div>
            </div>
          )}

          {staffName && demo.loading && !demo.requestInfo && (
            <div className="waiting-status">
              <span className="loader" />
              <span>Initializing...</span>
            </div>
          )}

          {demo.complete && (
            <div className="complete-panel">
              <div className="success-banner">✓ Patient check-in received!</div>
              <p className="received-summary">{receivedCount} credential{receivedCount !== 1 ? 's' : ''} received and decrypted</p>
              <button className="start-button" onClick={() => location.reload()}>
                Start Another Check-in
              </button>
            </div>
          )}

          {demo.error && <div className="error-banner">Error: {demo.error}</div>}

          <TransactionBrowser request={demo.requestLog} response={demo.responseLog} />
        </div>
      </div>
    </>
  );
}
