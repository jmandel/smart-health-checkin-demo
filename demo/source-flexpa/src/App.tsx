import React, { useState, useEffect } from 'react';
import { importJWK, CompactEncrypt, jwtVerify, createLocalJWKSet } from 'jose';
import './styles.css';

// ============================================================================
// Types
// ============================================================================

interface QuestionnaireItem {
  linkId: string;
  text: string;
  type: string;
  required?: boolean;
}

interface Questionnaire {
  resourceType: string;
  id?: string;
  title?: string;
  status: string;
  item: QuestionnaireItem[];
}

interface CredentialMeta {
  profile?: string;
  questionnaire?: Questionnaire;
  questionnaireUrl?: string;
}

interface Credential {
  id: string;
  format: string;
  meta?: CredentialMeta;
}

interface DCQLQuery {
  credentials: Credential[];
  credential_sets?: Array<{ options: string[][]; required: boolean }>;
}

interface ClientMetadata {
  jwks: { keys: Array<Record<string, unknown>> };
  encrypted_response_enc_values_supported?: string[];
}

interface VerifierMetadata {
  client_id: string;
  client_name?: string;
  jwks_uri: string;
  response_uri_prefixes: string[];
  redirect_uris?: string[];
}

interface RequestItem {
  type: 'fhir-profile' | 'fhir-questionnaire';
  id: string;
  profile?: string;
  questionnaire?: Questionnaire;
  questionnaireUrl?: string;
}

interface VerifiedRequest {
  verifierOrigin: string;
  verifierMetadata: VerifierMetadata;
  state: string;
  nonce: string;
  responseUri: string;
  clientMetadata: ClientMetadata;
  dcqlQuery: DCQLQuery;
  requestItems: RequestItem[];
}

interface FullArtifactPresentation {
  type: string;
  data: unknown;
  artifact_id?: string;
}

interface RefArtifactPresentation {
  artifact_ref: string;
}

type Presentation = FullArtifactPresentation | RefArtifactPresentation;

// ============================================================================
// Request resolution (async — fetches metadata, JWKS, signed Request Object)
// ============================================================================

async function resolveRequest(): Promise<VerifiedRequest | { error: string }> {
  const params = new URLSearchParams(location.search);
  const clientId = params.get('client_id');
  const requestUri = params.get('request_uri');
  const requestUriMethod = params.get('request_uri_method') || 'post';

  if (!clientId?.startsWith('well_known:')) {
    return { error: 'Invalid client_id: must use well_known: prefix' };
  }
  if (!requestUri) {
    return { error: 'Missing request_uri' };
  }

  const verifierOrigin = clientId.substring('well_known:'.length);

  // Validate bare origin
  try {
    const u = new URL(verifierOrigin);
    if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
      return { error: 'well_known: client_id must be a bare origin' };
    }
  } catch {
    return { error: 'Invalid origin in well_known: client_id' };
  }

  // 1. Fetch verifier metadata
  let metadata: VerifierMetadata;
  try {
    const resp = await fetch(`${verifierOrigin}/.well-known/openid4vp-client`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    metadata = await resp.json();
  } catch (err) {
    return { error: `Failed to fetch verifier metadata: ${err}` };
  }

  if (metadata.client_id !== clientId) {
    return { error: 'Metadata client_id does not match bootstrap client_id' };
  }

  // 2. Fetch JWKS
  let jwks: { keys: object[] };
  try {
    const resp = await fetch(metadata.jwks_uri);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    jwks = await resp.json();
  } catch (err) {
    return { error: `Failed to fetch JWKS: ${err}` };
  }

  // 3. Fetch signed Request Object
  let requestObjectJwt: string;
  try {
    const resp = await fetch(requestUri, {
      method: requestUriMethod === 'post' ? 'POST' : 'GET',
      headers: requestUriMethod === 'post' ? { 'Content-Type': 'application/json' } : {},
      body: requestUriMethod === 'post' ? '{}' : undefined,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    requestObjectJwt = await resp.text();
  } catch (err) {
    return { error: `Failed to fetch Request Object: ${err}` };
  }

  // 4. Verify JWT signature
  let payload: Record<string, unknown>;
  try {
    const keySet = createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]);
    const result = await jwtVerify(requestObjectJwt, keySet, {
      audience: 'https://self-issued.me/v2',
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    return { error: `Request Object signature verification failed: ${err}` };
  }

  // 5. Validate payload
  if (payload.client_id !== clientId) {
    return { error: 'Request Object client_id does not match bootstrap client_id' };
  }

  const responseUri = payload.response_uri as string;
  if (!responseUri) {
    return { error: 'Request Object missing response_uri' };
  }

  const prefixMatch = metadata.response_uri_prefixes.some(
    (prefix: string) => responseUri.startsWith(prefix)
  );
  if (!prefixMatch) {
    return { error: 'response_uri does not match any allowed response_uri_prefixes' };
  }

  const clientMetadata = payload.client_metadata as ClientMetadata;
  if (!clientMetadata?.jwks?.keys?.length) {
    return { error: 'Request Object missing client_metadata with encryption keys' };
  }

  const dcqlQuery = payload.dcql_query as DCQLQuery;
  if (!dcqlQuery) {
    return { error: 'Request Object missing dcql_query' };
  }

  const requestItems: RequestItem[] = (dcqlQuery.credentials || []).map(c => {
    const meta = c.meta || {};
    return {
      type: (meta.questionnaire || meta.questionnaireUrl) ? 'fhir-questionnaire' as const : 'fhir-profile' as const,
      id: c.id,
      profile: meta.profile,
      questionnaire: meta.questionnaire,
      questionnaireUrl: meta.questionnaireUrl,
    };
  });

  return {
    verifierOrigin,
    verifierMetadata: metadata,
    state: payload.state as string,
    nonce: payload.nonce as string,
    responseUri,
    clientMetadata,
    dcqlQuery,
    requestItems,
  };
}

// ============================================================================
// Encrypt and POST helper
// ============================================================================

async function encryptAndPost(
  payload: object,
  clientMetadata: ClientMetadata,
  responseUri: string
): Promise<{ redirect_uri?: string; status?: string }> {
  const jwk = clientMetadata.jwks.keys[0];
  const encKey = await importJWK(jwk, 'ECDH-ES');
  const enc = clientMetadata.encrypted_response_enc_values_supported?.[0] || 'A256GCM';

  const jwe = await new CompactEncrypt(
    new TextEncoder().encode(JSON.stringify(payload))
  )
    .setProtectedHeader({ alg: 'ECDH-ES', enc })
    .encrypt(encKey);

  const resp = await fetch(responseUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `response=${encodeURIComponent(jwe)}`,
  });

  if (!resp.ok) throw new Error(`POST to response_uri failed: ${resp.status}`);
  return resp.json();
}

// ============================================================================
// UI Components
// ============================================================================

function RequesterOrigin({ verifierOrigin }: { verifierOrigin: string }) {
  return (
    <div className="requester-origin">
      <div className="requester-origin-label">Requesting verification from</div>
      <div className="requester-origin-value">{verifierOrigin}</div>
    </div>
  );
}

function TechnicalDetails({ state, nonce, requestItems, verifierOrigin, responseUri }: {
  state: string; nonce: string; requestItems: RequestItem[]; verifierOrigin: string; responseUri: string;
}) {
  return (
    <div className="request-box">
      <h2>Technical Details</h2>
      <div className="request-detail">
        <div className="label">Protocol:</div>
        <div className="value">smart-health-checkin-v1</div>
      </div>
      <div className="request-detail">
        <div className="label">client_id:</div>
        <div className="value">well_known:{verifierOrigin}</div>
      </div>
      <div className="request-detail">
        <div className="label">response_mode:</div>
        <div className="value">direct_post.jwt</div>
      </div>
      <div className="request-detail">
        <div className="label">response_uri:</div>
        <div className="value">{responseUri}</div>
      </div>
      <div className="request-detail">
        <div className="label">state:</div>
        <div className="value">{state}</div>
      </div>
      <div className="request-detail">
        <div className="label">nonce:</div>
        <div className="value">{nonce}</div>
      </div>
      <div className="request-detail">
        <div className="label">Request Object:</div>
        <div className="value" style={{ color: '#4ade80' }}>Signature verified ✓</div>
      </div>
      <div className="request-detail">
        <div className="label">Requested items ({requestItems.length}):</div>
        {requestItems.map(item => (
          <div key={item.id} className="request-item">
            <div className="request-item-type">
              {item.type === 'fhir-profile' ? '📋 Profile' : '📝 Questionnaire'}: {item.id}
            </div>
            <div className="value">
              {item.profile || item.questionnaireUrl || 'Inline questionnaire'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsuranceSection({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="section">
      <h3>📋 Requested Records</h3>
      <label className="checkbox-card">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <div className="checkbox-content">
          <div className="checkbox-title">Share Insurance Card & History</div>
          <div className="checkbox-desc">Includes coverage details and claims history from Aetna</div>
          <div className="card-preview">
            <h4>Aetna PPO Plan</h4>
            <div className="card-info">
              <div><strong>Member:</strong> Jane Doe</div>
              <div><strong>Member ID:</strong> W123456789</div>
              <div><strong>Group:</strong> TECH-2024</div>
            </div>
          </div>
        </div>
      </label>
    </div>
  );
}

function ClinicalSection({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox-card">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div className="checkbox-content">
        <div className="checkbox-title">Share Clinical History</div>
        <div className="checkbox-desc">Includes medications, allergies, and conditions</div>
      </div>
    </label>
  );
}

function QuestionnaireSection({
  item, idx, checked, onChange, values, onValueChange
}: {
  item: RequestItem; idx: number; checked: boolean; onChange: (v: boolean) => void;
  values: Record<string, string>; onValueChange: (linkId: string, value: string) => void;
}) {
  const questionnaire = item.questionnaire;
  if (!questionnaire) return null;

  return (
    <div className="section">
      <h3>📝 {questionnaire.title || 'Form to Complete'}</h3>
      <div className="auto-filled-banner">
        ✨ We found matching records and auto-filled your Intake Form
      </div>
      <label className="checkbox-card">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <div className="checkbox-content">
          <div className="checkbox-title">Share Completed Form</div>
          <div className="form-preview">
            {questionnaire.item.map(question => (
              <div key={question.linkId} className="questionnaire-item">
                <label htmlFor={`q-${idx}-${question.linkId}`}>
                  {question.text}
                  {question.required && <span style={{ color: '#dc2626' }}> *</span>}
                </label>
                {question.type === 'text' ? (
                  <textarea
                    id={`q-${idx}-${question.linkId}`}
                    rows={3}
                    value={values[question.linkId] || ''}
                    onChange={e => onValueChange(question.linkId, e.target.value)}
                    className={values[question.linkId] ? 'auto-filled-field' : ''}
                  />
                ) : (
                  <input
                    type={question.type === 'date' ? 'date' : 'text'}
                    id={`q-${idx}-${question.linkId}`}
                    value={values[question.linkId] || ''}
                    onChange={e => onValueChange(question.linkId, e.target.value)}
                    className={values[question.linkId] ? 'auto-filled-field' : ''}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </label>
    </div>
  );
}

// ============================================================================
// Main App
// ============================================================================

export default function App() {
  const [parsed, setParsed] = useState<VerifiedRequest | { error: string } | null>(null);
  const [resolving, setResolving] = useState(true);

  const [shareInsurance, setShareInsurance] = useState(true);
  const [shareClinical, setShareClinical] = useState(true);
  const [shareQuestionnaires, setShareQuestionnaires] = useState<Record<string, boolean>>({});
  const [questionnaireValues, setQuestionnaireValues] = useState<Record<string, Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    resolveRequest().then(result => {
      setParsed(result);
      setResolving(false);

      // Initialize questionnaire states
      if (!('error' in result)) {
        const qItems = result.requestItems.filter(i => i.type === 'fhir-questionnaire');
        const initialShare: Record<string, boolean> = {};
        const initialValues: Record<string, Record<string, string>> = {};

        qItems.forEach(item => {
          initialShare[item.id] = true;
          initialValues[item.id] = {};
          if (item.questionnaire?.item) {
            item.questionnaire.item.forEach(q => {
              if (q.linkId === '1') initialValues[item.id][q.linkId] = 'Jane Doe';
              else if (q.linkId === '2') initialValues[item.id][q.linkId] = '1985-06-15';
              else if (q.linkId === '3') initialValues[item.id][q.linkId] = 'Hypertension';
              else if (q.linkId === '4') initialValues[item.id][q.linkId] = 'Lisinopril';
              else if (q.linkId === '5') initialValues[item.id][q.linkId] = 'Penicillin';
            });
          }
        });

        if (Object.keys(initialShare).length > 0) {
          setShareQuestionnaires(initialShare);
          setQuestionnaireValues(initialValues);
        }
      }
    });
  }, []);

  if (resolving) {
    return (
      <div className="container" style={{ textAlign: 'center', paddingTop: '80px' }}>
        <div className="logo">
          {[...Array(6)].map((_, i) => <div key={i} className="pixel" />)}
        </div>
        <h1>Flexpa</h1>
        <p style={{ color: '#9ca3af' }}>Verifying request...</p>
      </div>
    );
  }

  if (!parsed || 'error' in parsed) {
    return (
      <div className="container">
        <div className="logo">
          {[...Array(6)].map((_, i) => <div key={i} className="pixel" />)}
        </div>
        <h1>Flexpa</h1>
        <div className="error-message">{parsed?.error || 'Unknown error'}</div>
      </div>
    );
  }

  const { verifierOrigin, state, nonce, requestItems, dcqlQuery, responseUri, clientMetadata } = parsed;

  if (submitted) {
    return (
      <div className="container" style={{ textAlign: 'center', paddingTop: '80px' }}>
        <div className="logo">
          {[...Array(6)].map((_, i) => <div key={i} className="pixel" />)}
        </div>
        <h1>Flexpa</h1>
        <h2 style={{ color: '#4ade80', marginTop: '24px' }}>Submission complete</h2>
        <p style={{ color: '#9ca3af', marginTop: '8px' }}>You can close this tab.</p>
      </div>
    );
  }

  const profiles = requestItems.filter(i => i.type === 'fhir-profile');
  const questionnaires = requestItems.filter(i => i.type === 'fhir-questionnaire');
  const hasPatient = profiles.some(p => p.profile?.toLowerCase().includes('patient'));

  const tryCloseOrShowDone = () => {
    setSubmitted(true);
    try { window.close(); } catch { /* ignore */ }
  };

  const handleCancel = async () => {
    setSubmitting(true);
    try {
      const payload = { error: 'access_denied', error_description: 'User declined to share', state };
      const postResult = await encryptAndPost(payload, clientMetadata, responseUri);
      if (postResult.redirect_uri) {
        window.location.href = postResult.redirect_uri;
        return;
      }
    } catch (err) {
      console.error('Failed to post cancel response:', err);
    }
    tryCloseOrShowDone();
  };

  const handleShare = async () => {
    setSubmitting(true);
    try {
      const vp_token: Record<string, Presentation[]> = {};
      const artifactIdCache = new Map<string, string>();
      let artifactCounter = 0;

      const addPresentation = (type: string, data: unknown): Presentation => {
        const hash = JSON.stringify({ type, data });
        const existingId = artifactIdCache.get(hash);
        if (existingId) return { artifact_ref: existingId };
        const artifact_id = `art_${artifactCounter++}`;
        artifactIdCache.set(hash, artifact_id);
        return { artifact_id, type, data };
      };

      dcqlQuery.credentials.forEach(cred => {
        const meta = cred.meta || {};
        const profile = meta.profile;
        const questionnaire = meta.questionnaire;

        let resourceType: string | null = null;
        if (profile) {
          const match = profile.match(/StructureDefinition\/([A-Za-z0-9-]+)/);
          if (match) {
            const def = match[1];
            if (def.includes('Coverage')) resourceType = 'Coverage';
            else if (def.toLowerCase().includes('patient')) resourceType = 'Patient';
            else resourceType = def;
          }
        }
        if (questionnaire) resourceType = 'QuestionnaireResponse';

        let isShared = false;
        if (resourceType === 'Coverage') isShared = shareInsurance;
        else if (resourceType === 'Patient') isShared = shareClinical;
        else if (resourceType === 'QuestionnaireResponse') isShared = shareQuestionnaires[cred.id] ?? false;

        if (!isShared) return;

        const presentations: Presentation[] = [];

        if (resourceType === 'Coverage') {
          presentations.push(addPresentation('fhir_resource', {
            resourceType: 'Coverage', id: 'coverage-1', status: 'active',
            subscriberId: 'W123456789',
            beneficiary: { reference: 'Patient/patient-1', display: 'Jane Doe' },
            payor: [{ display: 'Aetna' }],
            class: [{ type: { coding: [{ code: 'group' }] }, value: 'TECH-2024' }]
          }));
        } else if (resourceType === 'Patient') {
          presentations.push(addPresentation('fhir_resource', {
            resourceType: 'Patient', id: 'patient-1',
            name: [{ text: 'Jane Doe', family: 'Doe', given: ['Jane'] }],
            birthDate: '1985-06-15'
          }));
        } else if (resourceType === 'QuestionnaireResponse') {
          const values = questionnaireValues[cred.id] || {};
          const items = Object.entries(values)
            .filter(([, v]) => v)
            .map(([linkId, value]) => ({ linkId, answer: [{ valueString: value }] }));
          presentations.push(addPresentation('fhir_resource', {
            resourceType: 'QuestionnaireResponse', status: 'completed', item: items
          }));
        }

        vp_token[cred.id] = presentations;
      });

      const payload = { vp_token, state };
      const postResult = await encryptAndPost(payload, clientMetadata, responseUri);

      if (postResult.redirect_uri) {
        window.location.href = postResult.redirect_uri;
        return;
      }

      tryCloseOrShowDone();
    } catch (err) {
      console.error('Failed to post share response:', err);
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="logo">
        {[...Array(6)].map((_, i) => <div key={i} className="pixel" />)}
      </div>
      <h1>Flexpa</h1>
      <div className="subtitle">Building blocks of health data</div>

      <RequesterOrigin verifierOrigin={verifierOrigin} />
      <TechnicalDetails state={state} nonce={nonce} requestItems={requestItems}
        verifierOrigin={verifierOrigin} responseUri={responseUri} />

      {profiles.length > 0 && (
        <>
          <InsuranceSection checked={shareInsurance} onChange={setShareInsurance} />
          {hasPatient && (
            <ClinicalSection checked={shareClinical} onChange={setShareClinical} />
          )}
        </>
      )}

      {questionnaires.map((item, idx) => (
        <QuestionnaireSection
          key={item.id}
          item={item}
          idx={idx}
          checked={shareQuestionnaires[item.id] ?? true}
          onChange={v => setShareQuestionnaires(prev => ({ ...prev, [item.id]: v }))}
          values={questionnaireValues[item.id] || {}}
          onValueChange={(linkId, value) =>
            setQuestionnaireValues(prev => ({
              ...prev,
              [item.id]: { ...prev[item.id], [linkId]: value }
            }))
          }
        />
      ))}

      <div className="actions">
        <button className="btn-secondary" onClick={handleCancel} disabled={submitting}>Cancel</button>
        <button className="btn-primary" onClick={handleShare} disabled={submitting}>
          {submitting ? 'Sharing...' : 'Share Selected Data'}
        </button>
      </div>
    </div>
  );
}
