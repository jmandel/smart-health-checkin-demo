import React, { useEffect, useState } from 'react';
import { maybeHandleReturn, type DCQLQuery } from 'smart-health-checkin';
import { config } from '../../config';
import { useDemoRequest } from '../../shared/useDemoRequest';
import { TransactionBrowser } from '../../shared/TransactionBrowser';
import { migraineQuestionnaire } from '../../shared/migraineQuestionnaire';
import { C4DIC_COVERAGE_PROFILE, SBC_INSURANCE_PLAN_PROFILE } from '../../shared/carinInsuranceExamples';
import { CLINICAL_HISTORY_PROFILES } from '../../shared/clinicalHistoryExamples';
import './styles.css';

function hasResponseCodeHash(): boolean {
  return new URLSearchParams(location.hash.substring(1)).has('response_code');
}

function ReturnCompleteScreen() {
  return (
    <>
      <header>
        <div className="header-content">
          <div className="logo">DM</div>
          <h2 className="clinic-name">Dr. Mandel's Family Medicine</h2>
        </div>
      </header>

      <div className="container">
        <div className="card return-card">
          <div className="return-icon">✓</div>
          <h1>Check-in shared</h1>
          <p className="subtitle">
            This tab delivered the completion code to your original patient portal tab.
            You can return there to continue.
          </p>
          <div className="return-actions">
            <button className="checkin-button complete" onClick={() => window.close()}>
              Close this tab
            </button>
          </div>
          <p className="return-note">
            Some mobile browsers keep this handoff tab open after launching another app.
          </p>
        </div>
      </div>
    </>
  );
}

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

export default function App() {
  const [returnHandled, setReturnHandled] = useState(
    () => hasResponseCodeHash() || sessionStorage.getItem('shc-return-tab') === '1'
  );

  const demo = useDemoRequest(dcqlQuery, {
    walletUrl: config.portal.walletUrl,
    wellKnownClientUrl: config.wellKnownClientUrl,
    flow: 'same-device',
  });

  useEffect(() => {
    let mounted = true;
    maybeHandleReturn().then((handled) => {
      if (!handled || !mounted) return;
      sessionStorage.setItem('shc-return-tab', '1');
      setReturnHandled(true);
    });
    return () => { mounted = false; };
  }, []);

  if (returnHandled) {
    return <ReturnCompleteScreen />;
  }

  const tasks = { insurance: false, plan: false, clinical: false, intake: false };

  if (demo.result?.credentials) {
    for (const items of Object.values(demo.result.credentials)) {
      for (const cred of items as Array<{ resourceType?: string }>) {
        if (cred.resourceType === 'Coverage') { tasks.insurance = true; }
        if (cred.resourceType === 'InsurancePlan') { tasks.plan = true; }
        if (cred.resourceType === 'Bundle' || cred.resourceType === 'Patient') { tasks.clinical = true; }
        if (cred.resourceType === 'QuestionnaireResponse') { tasks.intake = true; }
      }
    }
  }

  return (
    <>
      <header>
        <div className="header-content">
          <div className="logo">DM</div>
          <h2 className="clinic-name">Dr. Mandel's Family Medicine</h2>
        </div>
      </header>

      <div className="container">
        <div className="card">
          <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Same-Device Flow
          </div>
          <h1>Patient Portal Check-in</h1>
          <p className="subtitle">Share your health records directly from your device</p>

          <div className="task-list">
            {[
              { key: 'insurance', title: 'Insurance Information', desc: 'Digital insurance card with front/back card images', done: tasks.insurance },
              { key: 'plan', title: 'Plan Benefits Summary', desc: 'Deductibles, out-of-pocket limits, and common visit costs', done: tasks.plan },
              { key: 'clinical', title: 'Clinical History', desc: 'Patient details, allergies, and problem list', done: tasks.clinical },
              { key: 'intake', title: 'Migraine Check-in', desc: 'Brief recurring migraine follow-up', done: tasks.intake },
            ].map(t => (
              <div key={t.key} className={`task-item ${t.done ? 'completed' : ''}`}>
                <div className="task-status">{t.done ? '✓' : '⏳'}</div>
                <div className="task-details">
                  <div className="task-title">{t.title}</div>
                  <div className="task-description">{t.desc}</div>
                </div>
                <span className={`task-badge ${t.done ? 'badge-received' : 'badge-pending'}`}>
                  {t.done ? 'Received' : 'Pending'}
                </span>
              </div>
            ))}
          </div>

          {demo.complete && <div className="success-banner">✓ Registration information received successfully!</div>}
          {demo.error && <div className="error-banner">Error: {demo.error}</div>}

          <button className={`checkin-button ${demo.complete ? 'complete' : ''}`} onClick={demo.start} disabled={demo.loading}>
            {demo.loading ? (
              <><span className="loader" /><span style={{ marginLeft: 8 }}>Opening check-in...</span></>
            ) : demo.complete ? (
              <>
                <div className="checkin-button-icon">✓</div>
                <div className="checkin-button-text">
                  <div className="checkin-button-primary">Registration Complete</div>
                  <div className="checkin-button-secondary">Data received</div>
                </div>
              </>
            ) : (
              <>
                <div className="checkin-button-icon">🛡️</div>
                <div className="checkin-button-text">
                  <div className="checkin-button-primary">Share with SMART Health Check-in</div>
                  <div className="checkin-button-secondary">Connect your health app to auto-fill these forms</div>
                </div>
              </>
            )}
          </button>

          <TransactionBrowser request={demo.requestLog} response={demo.responseLog} />
        </div>
      </div>
    </>
  );
}
