import React, { useState, useEffect } from 'react';
import { importJWK, CompactEncrypt, jwtVerify, createLocalJWKSet } from 'jose';
import { carinCoverageExample, sbcInsurancePlanExample } from '../../shared/carinInsuranceExamples';
import { clinicalHistoryBundleExample } from '../../shared/clinicalHistoryExamples';
import migraineAutofillValues from '../../shared-data/migraine-autofill-values.json';
import './styles.css';

// ============================================================================
// Types
// ============================================================================

interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

interface QuestionnaireAnswerOption {
  valueCoding?: Coding;
  valueString?: string;
  valueInteger?: number;
  valueDate?: string;
  valueTime?: string;
  initialSelected?: boolean;
}

interface QuestionnaireInitial {
  valueBoolean?: boolean;
  valueDecimal?: number;
  valueInteger?: number;
  valueDate?: string;
  valueDateTime?: string;
  valueTime?: string;
  valueString?: string;
  valueCoding?: Coding;
}

interface QuestionnaireEnableWhen {
  question: string;
  operator: 'exists' | '=' | '!=' | '>' | '<' | '>=' | '<=';
  answerBoolean?: boolean;
  answerDecimal?: number;
  answerInteger?: number;
  answerDate?: string;
  answerDateTime?: string;
  answerTime?: string;
  answerString?: string;
  answerCoding?: Coding;
}

interface QuestionnaireItem {
  linkId: string;
  prefix?: string;
  text?: string;
  type: string;
  required?: boolean;
  repeats?: boolean;
  readOnly?: boolean;
  code?: Coding[];
  answerOption?: QuestionnaireAnswerOption[];
  initial?: QuestionnaireInitial[];
  enableWhen?: QuestionnaireEnableWhen[];
  enableBehavior?: 'all' | 'any';
  item?: QuestionnaireItem[];
}

interface Questionnaire {
  resourceType: string;
  id?: string;
  url?: string;
  title?: string;
  status: string;
  item: QuestionnaireItem[];
}

interface CredentialMeta {
  profile?: string;
  profiles?: string[];
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
}

type CompletionMode = 'redirect' | 'deferred';

interface RequestItem {
  type: 'fhir-profile' | 'fhir-questionnaire';
  id: string;
  profile?: string;
  profiles?: string[];
  questionnaire?: Questionnaire;
  questionnaireUrl?: string;
}

interface VerifiedRequest {
  verifierOrigin: string;
  verifierMetadata: VerifierMetadata;
  state: string;
  nonce: string;
  responseUri: string;
  completion: CompletionMode;
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
type QuestionnaireValue = string | boolean | string[];
type QuestionnaireValues = Record<string, QuestionnaireValue>;
type QuestionnaireAnswer = {
  valueString?: string;
  valueBoolean?: boolean;
  valueInteger?: number;
  valueDecimal?: number;
  valueDate?: string;
  valueCoding?: Coding;
};
type QuestionnaireResponseItem = {
  linkId: string;
  text?: string;
  answer?: QuestionnaireAnswer[];
  item?: QuestionnaireResponseItem[];
};
type CoverageImage = {
  label: string;
  contentType: string;
  data: string;
};
type CoverageExtension = {
  url?: string;
  extension?: Array<{
    url?: string;
    valueString?: string;
    valueAttachment?: { contentType?: string; data?: string };
  }>;
};

// ============================================================================
// Questionnaire helpers
// ============================================================================

const MIGRAINE_AUTOFILL_VALUES = migraineAutofillValues as QuestionnaireValues;

function answerOptionKey(option: QuestionnaireAnswerOption): string {
  if (option.valueCoding) return option.valueCoding.code || option.valueCoding.display || JSON.stringify(option.valueCoding);
  if (option.valueString != null) return option.valueString;
  if (option.valueInteger != null) return String(option.valueInteger);
  if (option.valueDate != null) return option.valueDate;
  if (option.valueTime != null) return option.valueTime;
  return JSON.stringify(option);
}

function answerOptionLabel(option: QuestionnaireAnswerOption): string {
  return option.valueCoding?.display || option.valueCoding?.code || option.valueString || String(option.valueInteger ?? option.valueDate ?? option.valueTime ?? '');
}

function initialToValue(initial: QuestionnaireInitial): QuestionnaireValue | undefined {
  if (initial.valueBoolean != null) return initial.valueBoolean;
  if (initial.valueInteger != null) return String(initial.valueInteger);
  if (initial.valueDecimal != null) return String(initial.valueDecimal);
  if (initial.valueDate != null) return initial.valueDate;
  if (initial.valueDateTime != null) return initial.valueDateTime;
  if (initial.valueTime != null) return initial.valueTime;
  if (initial.valueString != null) return initial.valueString;
  if (initial.valueCoding) return initial.valueCoding.code || initial.valueCoding.display || JSON.stringify(initial.valueCoding);
  return undefined;
}

function initialValueForItem(item: QuestionnaireItem): QuestionnaireValue | undefined {
  const demoValue = MIGRAINE_AUTOFILL_VALUES[item.linkId];
  if (demoValue !== undefined) return demoValue;

  const selected = item.answerOption?.filter(o => o.initialSelected).map(answerOptionKey) || [];
  if (selected.length > 0) return item.repeats ? selected : selected[0];

  const initial = item.initial?.map(initialToValue).filter(v => v !== undefined) as QuestionnaireValue[] | undefined;
  if (initial?.length) return item.repeats ? initial.map(String) : initial[0];
  return undefined;
}

function collectInitialValues(items: QuestionnaireItem[] = [], values: QuestionnaireValues = {}): QuestionnaireValues {
  items.forEach(item => {
    if (item.type !== 'group' && item.type !== 'display') {
      const initial = initialValueForItem(item);
      if (initial !== undefined) values[item.linkId] = initial;
    }
    if (item.item) collectInitialValues(item.item, values);
  });
  return values;
}

function isAnswerPresent(value: QuestionnaireValue | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return true;
  return value != null && String(value).trim() !== '';
}

function conditionAnswerValue(condition: QuestionnaireEnableWhen): string | number | boolean | undefined {
  if (condition.answerBoolean != null) return condition.answerBoolean;
  if (condition.answerInteger != null) return condition.answerInteger;
  if (condition.answerDecimal != null) return condition.answerDecimal;
  if (condition.answerDate != null) return condition.answerDate;
  if (condition.answerDateTime != null) return condition.answerDateTime;
  if (condition.answerTime != null) return condition.answerTime;
  if (condition.answerString != null) return condition.answerString;
  if (condition.answerCoding) return condition.answerCoding.code || condition.answerCoding.display;
  return undefined;
}

function valuesEqual(actual: QuestionnaireValue, expected: string | number | boolean | undefined): boolean {
  if (expected === undefined) return false;
  const actualValues = Array.isArray(actual) ? actual : [actual];
  return actualValues.some(v => String(v) === String(expected));
}

function compareValues(actual: QuestionnaireValue | undefined, expected: string | number | boolean | undefined, operator: QuestionnaireEnableWhen['operator']): boolean {
  if (operator === 'exists') return isAnswerPresent(actual) === Boolean(expected);
  if (actual === undefined) return false;
  if (operator === '=') return valuesEqual(actual, expected);
  if (operator === '!=') return !valuesEqual(actual, expected);

  const left = Number(Array.isArray(actual) ? actual[0] : actual);
  const right = Number(expected);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  if (operator === '>') return left > right;
  if (operator === '<') return left < right;
  if (operator === '>=') return left >= right;
  if (operator === '<=') return left <= right;
  return true;
}

function isItemEnabled(item: QuestionnaireItem, values: QuestionnaireValues): boolean {
  if (!item.enableWhen?.length) return true;
  const results = item.enableWhen.map(condition =>
    compareValues(values[condition.question], conditionAnswerValue(condition), condition.operator)
  );
  return item.enableBehavior === 'any' ? results.some(Boolean) : results.every(Boolean);
}

function answerFromOption(option: QuestionnaireAnswerOption): QuestionnaireAnswer {
  if (option.valueCoding) return { valueCoding: option.valueCoding };
  if (option.valueString != null) return { valueString: option.valueString };
  if (option.valueInteger != null) return { valueInteger: option.valueInteger };
  if (option.valueDate != null) return { valueDate: option.valueDate };
  return { valueString: answerOptionKey(option) };
}

function answersForItem(item: QuestionnaireItem, value: QuestionnaireValue | undefined): QuestionnaireAnswer[] {
  if (!isAnswerPresent(value)) return [];

  if (item.type === 'boolean' && typeof value === 'boolean') return [{ valueBoolean: value }];
  if (item.type === 'integer') {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? [] : [{ valueInteger: parsed }];
  }
  if (item.type === 'decimal') {
    const parsed = Number.parseFloat(String(value));
    return Number.isNaN(parsed) ? [] : [{ valueDecimal: parsed }];
  }
  if (item.type === 'date') return [{ valueDate: String(value) }];
  if (item.type === 'choice' || item.type === 'open-choice') {
    const keys = Array.isArray(value) ? value : [String(value)];
    return keys.map(key => {
      const option = item.answerOption?.find(o => answerOptionKey(o) === key);
      return option ? answerFromOption(option) : { valueString: key };
    });
  }

  return [{ valueString: String(value) }];
}

function buildQuestionnaireResponseItems(items: QuestionnaireItem[] = [], values: QuestionnaireValues): QuestionnaireResponseItem[] {
  return items.flatMap(item => {
    if (!isItemEnabled(item, values)) return [];
    if (item.type === 'display') return [{ linkId: item.linkId, text: item.text }];
    if (item.type === 'group') {
      const childItems = buildQuestionnaireResponseItems(item.item || [], values);
      return childItems.length ? [{ linkId: item.linkId, text: item.text, item: childItems }] : [];
    }

    const answer = answersForItem(item, values[item.linkId]);
    return answer.length ? [{ linkId: item.linkId, text: item.text, answer }] : [];
  });
}

// ============================================================================
// Request resolution (async — fetches metadata, JWKS, signed Request Object)
// ============================================================================

async function resolveRequest(): Promise<VerifiedRequest | { error: string }> {
  const params = new URLSearchParams(location.search);
  const clientId = params.get('client_id');
  const requestUri = params.get('request_uri');
  const requestUriMethod = params.get('request_uri_method') || 'get';

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

  // response_uri is trusted because the Request Object is signed by the
  // verifier's key (verified above). No separate metadata validation needed.

  const clientMetadata = payload.client_metadata as ClientMetadata;
  if (!clientMetadata?.jwks?.keys?.length) {
    return { error: 'Request Object missing client_metadata with encryption keys' };
  }

  const dcqlQuery = payload.dcql_query as DCQLQuery;
  if (!dcqlQuery) {
    return { error: 'Request Object missing dcql_query' };
  }

  const profileHints = payload.smart_health_checkin as { completion?: string } | undefined;
  const completion = profileHints?.completion;
  if (completion !== 'redirect' && completion !== 'deferred') {
    return { error: 'Request Object missing smart_health_checkin.completion' };
  }

  const requestItems: RequestItem[] = (dcqlQuery.credentials || []).map(c => {
    const meta = c.meta || {};
    return {
      type: (meta.questionnaire || meta.questionnaireUrl) ? 'fhir-questionnaire' as const : 'fhir-profile' as const,
      id: c.id,
      profile: meta.profile,
      profiles: meta.profiles,
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
    completion,
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

function coverageCardImages(): CoverageImage[] {
  return ((carinCoverageExample.extension || []) as CoverageExtension[])
    .filter(ext => ext.url?.endsWith('C4DIC-SupportingImage-extension'))
    .flatMap(ext => {
      const label = ext.extension?.find(child => child.url === 'label')?.valueString || 'Insurance card image';
      const image = ext.extension?.find(child => child.url === 'image')?.valueAttachment;
      if (!image?.contentType || !image.data) return [];
      return [{ label, contentType: image.contentType, data: image.data }];
    });
}

function RequesterOrigin({ verifierOrigin }: { verifierOrigin: string }) {
  return (
    <div className="requester-origin">
      <div className="requester-origin-label">Requesting verification from</div>
      <div className="requester-origin-value">{verifierOrigin}</div>
    </div>
  );
}

function TechnicalDetails({ state, nonce, requestItems, verifierOrigin, responseUri, completion }: {
  state: string; nonce: string; requestItems: RequestItem[]; verifierOrigin: string; responseUri: string; completion: CompletionMode;
}) {
  return (
    <details className="technical-details">
      <summary>
        <span>Technical Details</span>
        <span className="technical-details-meta">
          {requestItems.length} requested items · signature verified
        </span>
      </summary>
      <div className="request-box">
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
          <div className="label">completion:</div>
          <div className="value">{completion}</div>
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
          <div className="value" style={{ color: '#15803d' }}>Signature verified</div>
        </div>
        <div className="request-detail">
          <div className="label">Requested items ({requestItems.length}):</div>
          {requestItems.map(item => (
            <div key={item.id} className="request-item">
              <div className="request-item-type">
                {item.type === 'fhir-profile' ? '📋 Profile' : '📝 Questionnaire'}: {item.id}
              </div>
              <div className="value">
                {item.profiles?.length
                  ? item.profiles.map(profile => <div key={profile}>{profile}</div>)
                  : item.profile || item.questionnaireUrl || 'Inline questionnaire'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function RequestedRecordsSection({
  hasCoverage,
  hasInsurancePlan,
  hasClinicalHistory,
  shareInsurance,
  sharePlan,
  shareClinical,
  onShareInsuranceChange,
  onSharePlanChange,
  onShareClinicalChange
}: {
  hasCoverage: boolean;
  hasInsurancePlan: boolean;
  hasClinicalHistory: boolean;
  shareInsurance: boolean;
  sharePlan: boolean;
  shareClinical: boolean;
  onShareInsuranceChange: (v: boolean) => void;
  onSharePlanChange: (v: boolean) => void;
  onShareClinicalChange: (v: boolean) => void;
}) {
  return (
    <div className="section">
      <h3>📋 Requested Records</h3>
      {hasCoverage && (
        <InsuranceSection checked={shareInsurance} onChange={onShareInsuranceChange} />
      )}
      {hasInsurancePlan && (
        <PlanBenefitsSection checked={sharePlan} onChange={onSharePlanChange} />
      )}
      {hasClinicalHistory && (
        <ClinicalSection checked={shareClinical} onChange={onShareClinicalChange} />
      )}
    </div>
  );
}

function InsuranceSection({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const checkboxId = 'share-digital-insurance-card';
  return (
    <div className="checkbox-card">
      <input id={checkboxId} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div className="checkbox-content">
        <label htmlFor={checkboxId} className="checkbox-title">Share Digital Insurance Card</label>
        <div className="checkbox-desc">Includes coverage details and front/back card images from Aetna</div>
        <InsuranceCardPreview />
      </div>
    </div>
  );
}

function InsuranceCardPreview() {
  const images = coverageCardImages();
  const [selectedImage, setSelectedImage] = useState(0);
  const image = images[selectedImage];

  return (
    <div className="card-preview">
      <div className="card-preview-header">
        <h4>Aetna PPO Value Plan</h4>
      </div>
      <div className="card-info">
        <div><strong>Member:</strong> Jane Doe</div>
        <div><strong>Member ID:</strong> W123456789</div>
        <div><strong>Group:</strong> TECH-2024</div>
        <div><strong>Network:</strong> Aetna National PPO</div>
      </div>
      {image && (
        <figure className="card-image-preview">
          {images.length > 1 && (
            <div className="card-image-tabs" role="tablist" aria-label="Insurance card image side">
              {images.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  className={`card-image-tab ${index === selectedImage ? 'active' : ''}`}
                  onClick={() => setSelectedImage(index)}
                  role="tab"
                  aria-selected={index === selectedImage}
                >
                  {item.label.replace(' of insurance card', '')}
                </button>
              ))}
            </div>
          )}
          <img src={`data:${image.contentType};base64,${image.data}`} alt={image.label} />
          <figcaption>{image.label}</figcaption>
        </figure>
      )}
    </div>
  );
}

function PlanBenefitsSection({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox-card">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div className="checkbox-content">
        <div className="checkbox-title">Share Plan Benefits Summary</div>
        <div className="checkbox-desc">Includes deductible, out-of-pocket maximums, and common service costs</div>
        <div className="card-preview plan-preview">
          <h4>Aetna PPO Value Plan Benefits</h4>
          <div className="card-info">
            <div><strong>Deductible:</strong> $1,500 individual, $3,000 family</div>
            <div><strong>Out-of-pocket max:</strong> $6,000 individual, $12,000 family</div>
            <div><strong>Common costs:</strong> $25 primary care, $50 specialist, $10 generic drugs</div>
          </div>
        </div>
      </div>
    </label>
  );
}

function ClinicalSection({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox-card">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div className="checkbox-content">
        <div className="checkbox-title">Share Clinical History</div>
        <div className="checkbox-desc">Includes patient details, allergies, and problem list</div>
      </div>
    </label>
  );
}

function QuestionnaireSection({
  item, idx, checked, onChange, values, onValueChange
}: {
  item: RequestItem; idx: number; checked: boolean; onChange: (v: boolean) => void;
  values: QuestionnaireValues; onValueChange: (linkId: string, value: QuestionnaireValue) => void;
}) {
  const questionnaire = item.questionnaire;
  if (!questionnaire) return null;
  const shareId = `share-${idx}-${item.id}`;

  return (
    <div className="section">
      <h3>📝 {questionnaire.title || 'Form to Complete'}</h3>
      <div className="auto-filled-banner">
        ✨ We found matching headache diary entries and auto-filled your migraine check-in
      </div>
      <div className="checkbox-card">
        <input id={shareId} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <div className="checkbox-content">
          <label htmlFor={shareId} className="checkbox-title">Share Completed Form</label>
          <div className="form-preview">
            <QuestionnaireItems
              items={questionnaire.item}
              idx={idx}
              values={values}
              onValueChange={onValueChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestionnaireItems({
  items, idx, values, onValueChange, depth = 0
}: {
  items: QuestionnaireItem[]; idx: number; values: QuestionnaireValues;
  onValueChange: (linkId: string, value: QuestionnaireValue) => void; depth?: number;
}) {
  return (
    <>
      {items.map(question => (
        <QuestionnaireItemControl
          key={question.linkId}
          item={question}
          idx={idx}
          values={values}
          onValueChange={onValueChange}
          depth={depth}
        />
      ))}
    </>
  );
}

function QuestionnaireItemControl({
  item, idx, values, onValueChange, depth
}: {
  item: QuestionnaireItem; idx: number; values: QuestionnaireValues;
  onValueChange: (linkId: string, value: QuestionnaireValue) => void; depth: number;
}) {
  if (!isItemEnabled(item, values)) return null;

  if (item.type === 'display') {
    return <div className="questionnaire-display"><MarkdownText text={item.text} /></div>;
  }

  if (item.type === 'group') {
    return (
      <fieldset className="questionnaire-group" style={{ marginLeft: depth ? 8 : 0 }}>
        {item.text && <legend>{item.text}</legend>}
        <QuestionnaireItems
          items={item.item || []}
          idx={idx}
          values={values}
          onValueChange={onValueChange}
          depth={depth + 1}
        />
      </fieldset>
    );
  }

  const id = `q-${idx}-${item.linkId}`;
  const value = values[item.linkId];
  const hasValue = isAnswerPresent(value);
  const fieldClass = hasValue ? 'auto-filled-field' : '';

  return (
    <div className="questionnaire-item">
      <label htmlFor={id}>
        {item.prefix && <span className="question-prefix">{item.prefix}</span>}
        {item.text}
        {item.required && <span style={{ color: '#dc2626' }}> *</span>}
        {item.readOnly && <span className="read-only-pill">from diary</span>}
      </label>
      <QuestionnaireInput
        id={id}
        item={item}
        value={value}
        className={fieldClass}
        onValueChange={onValueChange}
      />
      {item.readOnly && (
        <div className="field-note">
          Supplied by your headache diary; not editable in this form.
        </div>
      )}
    </div>
  );
}

function MarkdownText({ text }: { text?: string }) {
  if (!text) return null;
  const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
        if (!match) return <React.Fragment key={i}>{part}</React.Fragment>;
        return (
          <a key={i} href={match[2]} target="_blank" rel="noreferrer">
            {match[1]}
          </a>
        );
      })}
    </>
  );
}

function QuestionnaireInput({
  id, item, value, className, onValueChange
}: {
  id: string; item: QuestionnaireItem; value: QuestionnaireValue | undefined; className: string;
  onValueChange: (linkId: string, value: QuestionnaireValue) => void;
}) {
  const disabled = Boolean(item.readOnly);

  if (item.type === 'text') {
    return (
      <textarea
        id={id}
        rows={3}
        value={typeof value === 'string' ? value : ''}
        onChange={e => onValueChange(item.linkId, e.target.value)}
        disabled={disabled}
        className={className}
      />
    );
  }

  if (item.type === 'boolean') {
    const checked = value === true;
    return (
      <label className={`boolean-control ${className}`}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={e => onValueChange(item.linkId, e.target.checked)}
          disabled={disabled}
        />
        <span>{checked ? 'Yes' : 'No'}</span>
      </label>
    );
  }

  if (item.type === 'choice' || item.type === 'open-choice') {
    return (
      <ChoiceInput
        id={id}
        item={item}
        value={value}
        disabled={disabled}
        className={className}
        onValueChange={onValueChange}
      />
    );
  }

  const inputType =
    item.type === 'date' ? 'date' :
    item.type === 'integer' || item.type === 'decimal' ? 'number' :
    'text';

  return (
    <input
      type={inputType}
      step={item.type === 'decimal' ? 'any' : undefined}
      id={id}
      value={typeof value === 'string' ? value : ''}
      onChange={e => onValueChange(item.linkId, e.target.value)}
      disabled={disabled}
      className={className}
    />
  );
}

function ChoiceInput({
  id, item, value, disabled, className, onValueChange
}: {
  id: string; item: QuestionnaireItem; value: QuestionnaireValue | undefined; disabled: boolean; className: string;
  onValueChange: (linkId: string, value: QuestionnaireValue) => void;
}) {
  const selected = Array.isArray(value) ? value : (typeof value === 'string' && value ? [value] : []);
  const options = item.answerOption || [];

  if (options.length === 0) {
    return (
      <input
        type="text"
        id={id}
        value={typeof value === 'string' ? value : ''}
        onChange={e => onValueChange(item.linkId, e.target.value)}
        disabled={disabled}
        className={className}
      />
    );
  }

  return (
    <div className={`choice-list ${className ? 'choice-list-filled' : ''}`}>
      {options.map(option => {
        const key = answerOptionKey(option);
        const checked = selected.includes(key);
        const optionId = `${id}-${key}`;
        return (
          <label key={key} htmlFor={optionId} className="choice-option">
            <input
              id={optionId}
              type={item.repeats ? 'checkbox' : 'radio'}
              name={id}
              checked={checked}
              disabled={disabled}
              onChange={e => {
                if (item.repeats) {
                  const next = e.target.checked
                    ? [...selected, key]
                    : selected.filter(v => v !== key);
                  onValueChange(item.linkId, next);
                } else {
                  onValueChange(item.linkId, key);
                }
              }}
            />
            <span>{answerOptionLabel(option)}</span>
          </label>
        );
      })}
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
  const [sharePlan, setSharePlan] = useState(true);
  const [shareClinical, setShareClinical] = useState(true);
  const [shareQuestionnaires, setShareQuestionnaires] = useState<Record<string, boolean>>({});
  const [questionnaireValues, setQuestionnaireValues] = useState<Record<string, QuestionnaireValues>>({});
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
        const initialValues: Record<string, QuestionnaireValues> = {};

        qItems.forEach(item => {
          initialShare[item.id] = true;
          initialValues[item.id] = item.questionnaire?.item
            ? collectInitialValues(item.questionnaire.item)
            : {};
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
        <h1>Sample Health App</h1>
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
        <h1>Sample Health App</h1>
        <div className="error-message">{parsed?.error || 'Unknown error'}</div>
      </div>
    );
  }

  const { verifierOrigin, state, nonce, requestItems, dcqlQuery, responseUri, completion, clientMetadata } = parsed;

  if (submitted) {
    return (
      <div className="container" style={{ textAlign: 'center', paddingTop: '80px' }}>
        <div className="logo">
          {[...Array(6)].map((_, i) => <div key={i} className="pixel" />)}
        </div>
        <h1>Sample Health App</h1>
        <h2 style={{ color: '#4ade80', marginTop: '24px' }}>Submission complete</h2>
        <p style={{ color: '#9ca3af', marginTop: '8px' }}>You can close this tab.</p>
      </div>
    );
  }

  const profiles = requestItems.filter(i => i.type === 'fhir-profile');
  const questionnaires = requestItems.filter(i => i.type === 'fhir-questionnaire');
  const hasCoverage = profiles.some(p => p.profile?.includes('C4DIC-Coverage') || p.profile?.toLowerCase().includes('coverage'));
  const hasInsurancePlan = profiles.some(p => {
    const profile = p.profile?.toLowerCase() || '';
    return profile.includes('sbc-insurance-plan') || profile.includes('insuranceplan');
  });
  const hasClinicalHistory = profiles.some(p => {
    const profileList = [p.profile, ...(p.profiles || [])].filter(Boolean).map(profile => profile!.toLowerCase());
    return profileList.some(profile =>
      profile.includes('patient') ||
      profile.includes('allergyintolerance') ||
      profile.includes('condition-problems-health-concerns')
    );
  });

  const tryCloseOrShowDone = () => {
    setSubmitted(true);
    try { window.close(); } catch { /* ignore */ }
  };

  const handleCancel = async () => {
    setSubmitting(true);
    try {
      const payload = { error: 'access_denied', error_description: 'User declined to share', state };
      const postResult = await encryptAndPost(payload, clientMetadata, responseUri);
      if (completion === 'redirect') {
        if (!postResult.redirect_uri) throw new Error('Expected redirect_uri for redirect completion');
        window.location.replace(postResult.redirect_uri);
        return;
      }
      if (postResult.redirect_uri) throw new Error('Unexpected redirect_uri for deferred completion');
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
        if (meta.profiles?.length) {
          const lowerProfiles = meta.profiles.map(item => item.toLowerCase());
          if (
            lowerProfiles.some(item => item.includes('patient')) &&
            lowerProfiles.some(item => item.includes('allergyintolerance')) &&
            lowerProfiles.some(item => item.includes('condition-problems-health-concerns'))
          ) {
            resourceType = 'ClinicalHistoryBundle';
          }
        }
        if (!resourceType && profile) {
          const match = profile.match(/StructureDefinition\/([A-Za-z0-9-]+)/);
          if (match) {
            const def = match[1];
            if (def.includes('Coverage')) resourceType = 'Coverage';
            else if (def === 'sbc-insurance-plan' || def.includes('InsurancePlan')) resourceType = 'InsurancePlan';
            else if (def.toLowerCase().includes('patient')) resourceType = 'Patient';
            else resourceType = def;
          }
        }
        if (questionnaire) resourceType = 'QuestionnaireResponse';

        let isShared = false;
        if (resourceType === 'Coverage') isShared = shareInsurance;
        else if (resourceType === 'InsurancePlan') isShared = sharePlan;
        else if (resourceType === 'Patient' || resourceType === 'ClinicalHistoryBundle') isShared = shareClinical;
        else if (resourceType === 'QuestionnaireResponse') isShared = shareQuestionnaires[cred.id] ?? false;

        if (!isShared) return;

        const presentations: Presentation[] = [];

        if (resourceType === 'Coverage') {
          presentations.push(addPresentation('fhir_resource', carinCoverageExample));
        } else if (resourceType === 'InsurancePlan') {
          presentations.push(addPresentation('fhir_resource', sbcInsurancePlanExample));
        } else if (resourceType === 'ClinicalHistoryBundle') {
          presentations.push(addPresentation('fhir_resource', clinicalHistoryBundleExample));
        } else if (resourceType === 'Patient') {
          presentations.push(addPresentation('fhir_resource', {
            resourceType: 'Patient', id: 'patient-1',
            name: [{ text: 'Jane Doe', family: 'Doe', given: ['Jane'] }],
            birthDate: '1985-06-15'
          }));
        } else if (resourceType === 'QuestionnaireResponse') {
          const values = questionnaireValues[cred.id] || {};
          const items = buildQuestionnaireResponseItems(questionnaire?.item || [], values);
          presentations.push(addPresentation('fhir_resource', {
            resourceType: 'QuestionnaireResponse',
            status: 'completed',
            questionnaire: questionnaire?.url || (questionnaire?.id ? `Questionnaire/${questionnaire.id}` : undefined),
            authored: new Date().toISOString(),
            item: items
          }));
        }

        vp_token[cred.id] = presentations;
      });

      const payload = { vp_token, state };
      const postResult = await encryptAndPost(payload, clientMetadata, responseUri);

      if (completion === 'redirect') {
        if (!postResult.redirect_uri) throw new Error('Expected redirect_uri for redirect completion');
        window.location.replace(postResult.redirect_uri);
        return;
      }
      if (postResult.redirect_uri) throw new Error('Unexpected redirect_uri for deferred completion');

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
      <h1>Sample Health App</h1>
      <div className="subtitle">Your health data, your choice</div>

      <RequesterOrigin verifierOrigin={verifierOrigin} />
      <TechnicalDetails state={state} nonce={nonce} requestItems={requestItems}
        verifierOrigin={verifierOrigin} responseUri={responseUri} completion={completion} />

      {profiles.length > 0 && (
        <RequestedRecordsSection
          hasCoverage={hasCoverage}
          hasInsurancePlan={hasInsurancePlan}
          hasClinicalHistory={hasClinicalHistory}
          shareInsurance={shareInsurance}
          sharePlan={sharePlan}
          shareClinical={shareClinical}
          onShareInsuranceChange={setShareInsurance}
          onSharePlanChange={setSharePlan}
          onShareClinicalChange={setShareClinical}
        />
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
