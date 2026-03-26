import React, { useEffect } from 'react';
import { maybeHandleReturn, type DCQLQuery } from 'smart-health-checkin';
import { config } from '../../config';
import { useDemoRequest } from '../../shared/useDemoRequest';
import { TransactionBrowser } from '../../shared/TransactionBrowser';
import './styles.css';

interface Coverage {
  resourceType: 'Coverage';
  subscriberId?: string;
  class?: Array<{ type?: { coding?: Array<{ code?: string }> }; value?: string }>;
  payor?: Array<{ display?: string }>;
}

interface Patient {
  resourceType: 'Patient';
  name?: Array<{ text?: string }>;
  birthDate?: string;
}

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

function InsuranceCard({ coverage, patient }: { coverage: Coverage; patient: Patient }) {
  const groupClass = coverage.class?.find(c => c.type?.coding?.[0]?.code === 'group');
  return (
    <div className="insurance-card">
      <div className="insurance-card-header">DIGITAL INSURANCE CARD</div>
      <div className="insurance-card-name">{patient.name?.[0]?.text || 'Patient Name'}</div>
      <div className="insurance-card-details">
        {[
          { label: 'Member ID', value: coverage.subscriberId || 'N/A' },
          { label: 'Group Number', value: groupClass?.value || 'N/A' },
          { label: 'Plan Name', value: coverage.payor?.[0]?.display || 'Health Plan' },
          { label: 'Date of Birth', value: patient.birthDate || 'N/A' },
        ].map(f => (
          <div key={f.label} className="insurance-card-field">
            <div className="insurance-card-label">{f.label}</div>
            <div className="insurance-card-value">{f.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const demo = useDemoRequest(dcqlQuery, {
    checkinBase: config.portal.checkin,
    verifierBase: config.verifier.base,
    flow: 'same-device',
  });

  useEffect(() => { maybeHandleReturn(); }, []);

  let coverage: Coverage | null = null;
  let patient: Patient | null = null;
  const tasks = { insurance: false, clinical: false, intake: false };

  if (demo.result?.credentials) {
    for (const items of Object.values(demo.result.credentials)) {
      for (const cred of items as Array<{ resourceType?: string }>) {
        if (cred.resourceType === 'Coverage') { coverage = cred as Coverage; tasks.insurance = true; }
        if (cred.resourceType === 'Patient') { patient = cred as Patient; tasks.clinical = true; }
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
              { key: 'insurance', title: 'Insurance Information', desc: 'Digital insurance card with coverage details', done: tasks.insurance },
              { key: 'clinical', title: 'Clinical History', desc: 'Health records, medications, and allergies', done: tasks.clinical },
              { key: 'intake', title: 'Patient Intake Form', desc: 'Basic demographics and health concerns', done: tasks.intake },
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
          {coverage && patient && <InsuranceCard coverage={coverage} patient={patient} />}
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
