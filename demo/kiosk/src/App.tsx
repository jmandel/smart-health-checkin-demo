import React, { useRef, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { type DCQLQuery } from 'smart-health-checkin';
import { config } from '../../config';
import { useDemoRequest } from '../../shared/useDemoRequest';
import { TransactionBrowser } from '../../shared/TransactionBrowser';
import './styles.css';

const dcqlQuery: DCQLQuery = {
  credentials: [
    {
      id: 'coverage-1', format: 'smart_artifact', require_cryptographic_holder_binding: false,
      meta: { profile: 'http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage' }
    },
    {
      id: 'patient-1', format: 'smart_artifact', require_cryptographic_holder_binding: false,
      meta: { profile: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient' }
    },
    {
      id: 'intake-questionnaire-1', format: 'smart_artifact', require_cryptographic_holder_binding: false,
      meta: {
        questionnaire: {
          resourceType: 'Questionnaire', id: 'patient-intake',
          title: "Patient Intake Form - Dr. Mandel's Clinic", status: 'active',
          item: [
            { linkId: '1', text: 'Full Name', type: 'string', required: true },
            { linkId: '2', text: 'Date of Birth', type: 'date', required: true },
            { linkId: '3', text: 'Primary Health Concerns', type: 'text', required: false },
            { linkId: '4', text: 'Current Medications', type: 'text', required: false },
            { linkId: '5', text: 'Known Allergies', type: 'string', required: false }
          ]
        }
      }
    }
  ],
  credential_sets: [
    { options: [['coverage-1']], required: false },
    { options: [['patient-1']], required: false },
    { options: [['intake-questionnaire-1']], required: false }
  ]
};

function QRPanel({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && url) {
      QRCode.toCanvas(canvasRef.current, url, { width: 280, margin: 2 });
    }
  }, [url]);

  const handleCopy = () => {
    navigator.clipboard.writeText(url);
  };

  return (
    <div className="qr-panel">
      <canvas ref={canvasRef} />
      <p className="qr-instruction">Scan with patient's phone or share the link</p>
      <div className="qr-link-row">
        <input type="text" readOnly value={url} className="qr-link-input" />
        <button onClick={handleCopy} className="qr-copy-btn">Copy</button>
      </div>
    </div>
  );
}

export default function App() {
  const demo = useDemoRequest(dcqlQuery, {
    checkinBase: config.kiosk.checkin,
    verifierBase: config.verifier.base,
    flow: 'cross-device',
  });

  // Auto-start on mount
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      demo.start();
    }
  }, []);

  // Extract summary from result
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
          <span className="header-badge">Front Desk</span>
        </div>
      </header>

      <div className="container">
        <div className="card">
          <div className="flow-badge">Cross-Device Flow</div>
          <h1>Front Desk Check-in</h1>
          <p className="subtitle">Start a check-in for a patient using their phone</p>

          {demo.loading && demo.requestInfo && (
            <div className="waiting-panel">
              <QRPanel url={demo.requestInfo.launch_url} />
              <div className="waiting-status">
                <span className="loader" />
                <span>Waiting for patient to complete check-in on their device...</span>
              </div>
            </div>
          )}

          {demo.loading && !demo.requestInfo && (
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
