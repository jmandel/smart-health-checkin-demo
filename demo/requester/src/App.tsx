import React, { useState, useEffect } from 'react';
import { request, maybeHandleReturn, type DCQLQuery, type RehydratedResponse } from 'smart-health-checkin';
import { config } from '../../config';
import './styles.css';

interface TaskState {
  insurance: boolean;
  clinical: boolean;
  intake: boolean;
}

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
      id: 'coverage-1',
      format: 'smart_artifact',
      optional: true,
      require_cryptographic_holder_binding: false,
      meta: {
        profile: 'http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage'
      }
    },
    {
      id: 'patient-1',
      format: 'smart_artifact',
      optional: true,
      require_cryptographic_holder_binding: false,
      meta: {
        profile: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'
      }
    },
    {
      id: 'intake-questionnaire-1',
      format: 'smart_artifact',
      optional: true,
      require_cryptographic_holder_binding: false,
      meta: {
        questionnaire: {
          resourceType: 'Questionnaire',
          id: 'patient-intake',
          title: "Patient Intake Form - Dr. Mandel's Clinic",
          status: 'active',
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
  ]
};

function TaskItem({ title, description, completed }: { title: string; description: string; completed: boolean }) {
  return (
    <div className={`task-item ${completed ? 'completed' : ''}`}>
      <div className="task-status">{completed ? '✓' : '⏳'}</div>
      <div className="task-details">
        <div className="task-title">{title}</div>
        <div className="task-description">{description}</div>
      </div>
      <span className={`task-badge ${completed ? 'badge-received' : 'badge-pending'}`}>
        {completed ? 'Received' : 'Pending'}
      </span>
    </div>
  );
}

function InsuranceCard({ coverage, patient }: { coverage: Coverage; patient: Patient }) {
  const groupClass = coverage.class?.find(c => c.type?.coding?.[0]?.code === 'group');

  return (
    <div className="insurance-card">
      <div className="insurance-card-header">DIGITAL INSURANCE CARD</div>
      <div className="insurance-card-name">{patient.name?.[0]?.text || 'Patient Name'}</div>
      <div className="insurance-card-details">
        <div className="insurance-card-field">
          <div className="insurance-card-label">Member ID</div>
          <div className="insurance-card-value">{coverage.subscriberId || 'N/A'}</div>
        </div>
        <div className="insurance-card-field">
          <div className="insurance-card-label">Group Number</div>
          <div className="insurance-card-value">{groupClass?.value || 'N/A'}</div>
        </div>
        <div className="insurance-card-field">
          <div className="insurance-card-label">Plan Name</div>
          <div className="insurance-card-value">{coverage.payor?.[0]?.display || 'Health Plan'}</div>
        </div>
        <div className="insurance-card-field">
          <div className="insurance-card-label">Date of Birth</div>
          <div className="insurance-card-value">{patient.birthDate || 'N/A'}</div>
        </div>
      </div>
    </div>
  );
}

function TransactionBrowser({ request: req, response }: { request: object | null; response: object | null }) {
  if (!req && !response) return null;

  return (
    <div className="transaction-browser">
      <div className="browser-section">
        <div className="browser-header">Request (OID4VP)</div>
        <pre className="browser-content">{JSON.stringify(req, null, 2)}</pre>
      </div>
      <div className="browser-section">
        <div className="browser-header">Response (OID4VP)</div>
        <pre className="browser-content">{JSON.stringify(response, null, 2)}</pre>
      </div>
    </div>
  );
}

export default function App() {
  const [tasks, setTasks] = useState<TaskState>({ insurance: false, clinical: false, intake: false });
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [requestLog, setRequestLog] = useState<object | null>(null);
  const [responseLog, setResponseLog] = useState<object | null>(null);

  useEffect(() => {
    maybeHandleReturn();
  }, []);

  const handleCheckin = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await request(dcqlQuery, {
        checkinBase: config.requester.checkin,
        onRequestStart: (params) => {
          const sanitized = { ...params };
          setRequestLog(sanitized);
          setResponseLog({ status: 'Waiting for response...' });
        }
      }) as RehydratedResponse;

      setResponseLog(result);

      // Process credentials
      if (result.credentials) {
        const newTasks = { ...tasks };

        for (const [, items] of Object.entries(result.credentials)) {
          for (const credential of items as Array<{ resourceType?: string }>) {
            if (credential.resourceType === 'Coverage') {
              setCoverage(credential as Coverage);
              newTasks.insurance = true;
            }
            if (credential.resourceType === 'Patient') {
              setPatient(credential as Patient);
              newTasks.clinical = true;
            }
            if (credential.resourceType === 'QuestionnaireResponse') {
              newTasks.intake = true;
            }
          }
        }

        setTasks(newTasks);
      }

      setComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

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
          <h1>New Patient Registration</h1>
          <p className="subtitle">Please complete your registration by providing the following information:</p>

          <div className="task-list">
            <TaskItem
              title="Insurance Information"
              description="Digital insurance card with coverage details"
              completed={tasks.insurance}
            />
            <TaskItem
              title="Clinical History"
              description="Health records, medications, and allergies"
              completed={tasks.clinical}
            />
            <TaskItem
              title="Patient Intake Form"
              description="Basic demographics and health concerns"
              completed={tasks.intake}
            />
          </div>

          {complete && (
            <div className="success-banner">
              ✓ Registration information received successfully!
            </div>
          )}

          {coverage && patient && (
            <InsuranceCard coverage={coverage} patient={patient} />
          )}

          {error && (
            <div className="error-banner">Error: {error}</div>
          )}

          <button
            className={`checkin-button ${complete ? 'complete' : ''}`}
            onClick={handleCheckin}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="loader" />
                <span style={{ marginLeft: 8 }}>Opening check-in...</span>
              </>
            ) : complete ? (
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

          <div className="manual-link">
            <a href="#" onClick={(e) => { e.preventDefault(); alert('Manual entry would open a 15-20 minute form process'); }}>
              Or fill out forms manually (15-20 mins)
            </a>
          </div>

          <TransactionBrowser request={requestLog} response={responseLog} />
        </div>
      </div>
    </>
  );
}
