export const SMART_HEALTH_CHECKIN_CREDENTIAL_ID = 'smart-checkin';
export const SMART_HEALTH_CHECKIN_FORMAT = 'smart_health_checkin';
export const SMART_HEALTH_CHECKIN_REQUEST_TYPE = 'smart-health-checkin-request';
export const SMART_HEALTH_CHECKIN_RESPONSE_TYPE = 'smart-health-checkin-response';
export const SMART_HEALTH_CHECKIN_VERSION = '1';
export const FHIR_JSON_MEDIA_TYPE = 'application/fhir+json';
export const SMART_HEALTH_CARD_MEDIA_TYPE = 'application/smart-health-card';

export type FhirCanonical = string;
export type FhirCanonicalUrl = string;
export type FhirRelease = string;
export type FhirResourceType = string;
export type MediaTypeString = string;

export interface FhirQuestionnaire {
  resourceType: 'Questionnaire';
  url?: string;
  version?: string;
  [fhirMember: string]: unknown;
}

export interface SelectionFhirSelector {
  kind: 'selection.fhir';
  profiles?: FhirCanonical[];
  profilesFrom?: FhirCanonicalUrl[];
  resourceTypes?: FhirResourceType[];
  [extensionMember: string]: unknown;
}

export interface FormFhirSelector {
  kind: 'form.fhir';
  questionnaireCanonical?: FhirCanonical;
  questionnaire?: FhirQuestionnaire;
  [extensionMember: string]: unknown;
}

export type SmartHealthCheckinSelector = SelectionFhirSelector | FormFhirSelector;

export interface SmartHealthCheckinRequestItem {
  id: string;
  title: string;
  summary?: string;
  required?: boolean;
  content: SmartHealthCheckinSelector;
  accept: MediaTypeString[];
  [extensionMember: string]: unknown;
}

export interface SmartHealthCheckinRequest {
  type: typeof SMART_HEALTH_CHECKIN_REQUEST_TYPE;
  version: typeof SMART_HEALTH_CHECKIN_VERSION;
  id: string;
  purpose?: string;
  fhirVersions?: FhirRelease[];
  items: SmartHealthCheckinRequestItem[];
  [extensionMember: string]: unknown;
}

export interface SmartArtifactBase {
  id: string;
  mediaType: MediaTypeString;
  fulfills: string[];
}

export interface SmartHealthCardArtifact extends SmartArtifactBase {
  mediaType: typeof SMART_HEALTH_CARD_MEDIA_TYPE;
  value: {
    verifiableCredential: string[];
    [payloadMember: string]: unknown;
  };
  fhirVersion?: never;
}

export interface FhirResource {
  resourceType: string;
  [fhirMember: string]: unknown;
}

export interface RawFhirJsonArtifact extends SmartArtifactBase {
  mediaType: typeof FHIR_JSON_MEDIA_TYPE;
  fhirVersion: FhirRelease;
  value: FhirResource;
}

export type SmartArtifact = SmartHealthCardArtifact | RawFhirJsonArtifact;

export type RequestItemStatusCode =
  | 'fulfilled'
  | 'partial'
  | 'unavailable'
  | 'declined'
  | 'unsupported'
  | 'error';

export interface RequestItemStatus {
  item: string;
  status: RequestItemStatusCode;
  message?: string;
  [extensionMember: string]: unknown;
}

export interface SmartHealthCheckinResponse {
  type: typeof SMART_HEALTH_CHECKIN_RESPONSE_TYPE;
  version: typeof SMART_HEALTH_CHECKIN_VERSION;
  requestId: string;
  artifacts: SmartArtifact[];
  requestStatus: RequestItemStatus[];
  [extensionMember: string]: unknown;
}

export interface SmartHealthCheckinCredentialQuery {
  id: string;
  format: typeof SMART_HEALTH_CHECKIN_FORMAT;
  require_cryptographic_holder_binding?: boolean;
  meta: {
    request: SmartHealthCheckinRequest;
    [member: string]: unknown;
  };
}

export interface DCQLQuery {
  credentials: SmartHealthCheckinCredentialQuery[];
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function buildSmartHealthCheckinDCQLQuery(
  request: SmartHealthCheckinRequest,
  credentialId = SMART_HEALTH_CHECKIN_CREDENTIAL_ID
): DCQLQuery {
  return {
    credentials: [
      {
        id: credentialId,
        format: SMART_HEALTH_CHECKIN_FORMAT,
        require_cryptographic_holder_binding: false,
        meta: { request },
      },
    ],
  };
}

export function validateSmartHealthCheckinRequest(value: unknown): ValidationResult<SmartHealthCheckinRequest> {
  if (!isRecord(value)) return { ok: false, error: 'request must be an object' };
  if (value.type !== SMART_HEALTH_CHECKIN_REQUEST_TYPE) {
    return { ok: false, error: `type must be "${SMART_HEALTH_CHECKIN_REQUEST_TYPE}"` };
  }
  if (value.version !== SMART_HEALTH_CHECKIN_VERSION) {
    return { ok: false, error: `version must be "${SMART_HEALTH_CHECKIN_VERSION}"` };
  }
  if (!nonEmptyString(value.id)) return { ok: false, error: 'id missing or not a string' };
  if (value.purpose !== undefined && typeof value.purpose !== 'string') {
    return { ok: false, error: 'purpose must be a string' };
  }
  if (value.fhirVersions !== undefined && !stringArray(value.fhirVersions, true)) {
    return { ok: false, error: 'fhirVersions must be a non-empty array of strings when present' };
  }
  if (!Array.isArray(value.items)) return { ok: false, error: 'items must be an array' };

  const ids = new Set<string>();
  for (let i = 0; i < value.items.length; i++) {
    const item = value.items[i];
    if (!isRecord(item)) return { ok: false, error: `items[${i}] is not an object` };
    if (!nonEmptyString(item.id)) return { ok: false, error: `items[${i}].id missing or not a string` };
    if (ids.has(item.id)) return { ok: false, error: `items[${i}].id is duplicated` };
    ids.add(item.id);
    if (!nonEmptyString(item.title)) return { ok: false, error: `items[${i}].title missing or not a string` };
    if (item.summary !== undefined && typeof item.summary !== 'string') {
      return { ok: false, error: `items[${i}].summary must be a string` };
    }
    if (item.required !== undefined && typeof item.required !== 'boolean') {
      return { ok: false, error: `items[${i}].required must be a boolean` };
    }
    if (!stringArray(item.accept, true)) {
      return { ok: false, error: `items[${i}].accept must be a non-empty array of strings` };
    }
    if (!isRecord(item.content)) return { ok: false, error: `items[${i}].content must be an object` };
    const contentError = validateContentSelector(item.content, `items[${i}].content`);
    if (contentError) return { ok: false, error: contentError };
  }

  return { ok: true, value: value as unknown as SmartHealthCheckinRequest };
}

export function validateSmartHealthCheckinResponse(value: unknown): ValidationResult<SmartHealthCheckinResponse> {
  if (!isRecord(value)) return { ok: false, error: 'response must be an object' };
  if (value.type !== SMART_HEALTH_CHECKIN_RESPONSE_TYPE) {
    return { ok: false, error: `type must be "${SMART_HEALTH_CHECKIN_RESPONSE_TYPE}"` };
  }
  if (value.version !== SMART_HEALTH_CHECKIN_VERSION) {
    return { ok: false, error: `version must be "${SMART_HEALTH_CHECKIN_VERSION}"` };
  }
  if (!nonEmptyString(value.requestId)) return { ok: false, error: 'requestId missing or not a string' };
  if (!Array.isArray(value.artifacts)) return { ok: false, error: 'artifacts must be an array' };
  if (!Array.isArray(value.requestStatus)) return { ok: false, error: 'requestStatus must be an array' };

  const artifactIds = new Set<string>();
  for (let i = 0; i < value.artifacts.length; i++) {
    const artifact = value.artifacts[i];
    if (!isRecord(artifact)) return { ok: false, error: `artifacts[${i}] is not an object` };
    if (!nonEmptyString(artifact.id)) return { ok: false, error: `artifacts[${i}].id missing or not a string` };
    if (artifactIds.has(artifact.id)) return { ok: false, error: `artifacts[${i}].id is duplicated` };
    artifactIds.add(artifact.id);
    if (!nonEmptyString(artifact.mediaType)) {
      return { ok: false, error: `artifacts[${i}].mediaType missing or not a string` };
    }
    if (!stringArray(artifact.fulfills, true)) {
      return { ok: false, error: `artifacts[${i}].fulfills must be a non-empty array of strings` };
    }
    const artifactError = validateArtifact(artifact, `artifacts[${i}]`);
    if (artifactError) return { ok: false, error: artifactError };
  }

  const seenStatus = new Set<string>();
  for (let i = 0; i < value.requestStatus.length; i++) {
    const status = value.requestStatus[i];
    if (!isRecord(status)) return { ok: false, error: `requestStatus[${i}] is not an object` };
    if (!nonEmptyString(status.item)) {
      return { ok: false, error: `requestStatus[${i}].item missing or not a string` };
    }
    if (seenStatus.has(status.item)) return { ok: false, error: `requestStatus[${i}].item is duplicated` };
    seenStatus.add(status.item);
    if (!['fulfilled', 'partial', 'unavailable', 'declined', 'unsupported', 'error'].includes(String(status.status))) {
      return { ok: false, error: `requestStatus[${i}].status invalid` };
    }
    if (status.message !== undefined && typeof status.message !== 'string') {
      return { ok: false, error: `requestStatus[${i}].message must be a string` };
    }
  }

  return { ok: true, value: value as unknown as SmartHealthCheckinResponse };
}

export function validateResponseAgainstRequest(
  request: unknown,
  response: unknown
): ValidationResult<SmartHealthCheckinResponse> {
  const requestValidation = validateSmartHealthCheckinRequest(request);
  if (!requestValidation.ok) return { ok: false, error: `request invalid: ${requestValidation.error}` };
  const responseValidation = validateSmartHealthCheckinResponse(response);
  if (!responseValidation.ok) return responseValidation;

  const req = requestValidation.value;
  const resp = responseValidation.value;
  if (resp.requestId !== req.id) {
    return { ok: false, error: `requestId must match request id ${req.id}` };
  }

  const itemsById = new Map(req.items.map((item) => [item.id, item]));
  for (let i = 0; i < resp.artifacts.length; i++) {
    const artifact = resp.artifacts[i]!;
    for (const itemId of artifact.fulfills) {
      const item = itemsById.get(itemId);
      if (!item) return { ok: false, error: `artifacts[${i}].fulfills references unknown item ${itemId}` };
      if (!item.accept.includes(artifact.mediaType)) {
        return {
          ok: false,
          error: `artifacts[${i}].mediaType "${artifact.mediaType}" is not accepted by item ${itemId} (accept: ${JSON.stringify(item.accept)})`,
        };
      }
    }

    if (artifact.mediaType === FHIR_JSON_MEDIA_TYPE && req.fhirVersions?.length) {
      const fhirVersion = artifact.fhirVersion;
      if (!req.fhirVersions.includes(fhirVersion)) {
        return {
          ok: false,
          error: `artifacts[${i}].fhirVersion "${fhirVersion}" is not in request.fhirVersions ${JSON.stringify(req.fhirVersions)}`,
        };
      }
    }
  }

  const statusItems = new Set(resp.requestStatus.map((status) => status.item));
  for (let i = 0; i < resp.requestStatus.length; i++) {
    const itemId = resp.requestStatus[i]!.item;
    if (!itemsById.has(itemId)) return { ok: false, error: `requestStatus[${i}].item references unknown item ${itemId}` };
  }
  for (const itemId of itemsById.keys()) {
    if (!statusItems.has(itemId)) return { ok: false, error: `requestStatus missing item ${itemId}` };
  }

  return responseValidation;
}

export function extractSmartHealthCheckinRequest(
  dcqlQuery: unknown
): ValidationResult<{ credentialId: string; request: SmartHealthCheckinRequest }> {
  if (!isRecord(dcqlQuery) || !Array.isArray(dcqlQuery.credentials)) {
    return { ok: false, error: 'dcql_query.credentials must be an array' };
  }

  const credential = dcqlQuery.credentials.find((item): item is Record<string, unknown> =>
    isRecord(item) && item.format === SMART_HEALTH_CHECKIN_FORMAT && isRecord(item.meta) && 'request' in item.meta
  );
  if (!credential) return { ok: false, error: `dcql_query missing ${SMART_HEALTH_CHECKIN_FORMAT} credential with meta.request` };

  const meta = credential.meta as Record<string, unknown>;
  const requestValidation = validateSmartHealthCheckinRequest(meta.request);
  if (!requestValidation.ok) return { ok: false, error: requestValidation.error };
  return {
    ok: true,
    value: {
      credentialId: typeof credential.id === 'string' && credential.id ? credential.id : SMART_HEALTH_CHECKIN_CREDENTIAL_ID,
      request: requestValidation.value,
    },
  };
}

export function extractSmartHealthCheckinResponse(
  vpToken: unknown,
  credentialId = SMART_HEALTH_CHECKIN_CREDENTIAL_ID
): ValidationResult<SmartHealthCheckinResponse> {
  if (!isRecord(vpToken)) return { ok: false, error: 'vp_token must be an object' };

  const candidate = vpToken[credentialId]
    ?? Object.values(vpToken).find((value) =>
      Array.isArray(value) && value.length === 1 && isRecord(value[0]) && value[0].type === SMART_HEALTH_CHECKIN_RESPONSE_TYPE
    );
  if (!Array.isArray(candidate)) {
    return { ok: false, error: `vp_token.${credentialId} must be an array of presentations` };
  }
  if (candidate.length !== 1) {
    return { ok: false, error: `vp_token.${credentialId} must contain exactly one presentation` };
  }

  const responseValidation = validateSmartHealthCheckinResponse(candidate[0]);
  if (!responseValidation.ok) return { ok: false, error: `vp_token missing valid SMART Health Check-in response: ${responseValidation.error}` };
  return responseValidation;
}

export function artifactsByItem(response: SmartHealthCheckinResponse): Record<string, SmartArtifact[]> {
  const grouped: Record<string, SmartArtifact[]> = {};
  for (const artifact of response.artifacts) {
    for (const itemId of artifact.fulfills) {
      (grouped[itemId] ||= []).push(artifact);
    }
  }
  return grouped;
}

export function artifactValuesByItem(response: SmartHealthCheckinResponse): Record<string, unknown[]> {
  const grouped: Record<string, unknown[]> = {};
  for (const artifact of response.artifacts) {
    for (const itemId of artifact.fulfills) {
      (grouped[itemId] ||= []).push(artifact.value);
    }
  }
  return grouped;
}

function validateContentSelector(content: Record<string, unknown>, path: string): string | undefined {
  if (content.kind === 'selection.fhir') {
    if (content.profiles !== undefined && !stringArray(content.profiles, true)) {
      return `${path}.profiles must be a non-empty array of strings when present`;
    }
    if (content.profilesFrom !== undefined && !stringArray(content.profilesFrom, true)) {
      return `${path}.profilesFrom must be a non-empty array of canonical URL strings when present`;
    }
    if (content.resourceTypes !== undefined && !stringArray(content.resourceTypes, true)) {
      return `${path}.resourceTypes must be a non-empty array of strings when present`;
    }
    if ('questionnaireCanonical' in content || 'questionnaire' in content) {
      return `${path} must not mix form.fhir fields into selection.fhir`;
    }
    return undefined;
  }

  if (content.kind === 'form.fhir') {
    if ('profiles' in content || 'profilesFrom' in content || 'resourceTypes' in content) {
      return `${path} must not mix selection.fhir fields into form.fhir`;
    }
    if (content.questionnaireCanonical === undefined && content.questionnaire === undefined) {
      return `${path} must include questionnaireCanonical or questionnaire`;
    }
    if (content.questionnaireCanonical !== undefined && !nonEmptyString(content.questionnaireCanonical)) {
      return `${path}.questionnaireCanonical must be a non-empty string`;
    }
    if (content.questionnaire !== undefined) {
      if (!isRecord(content.questionnaire)) return `${path}.questionnaire must be an object`;
      if (content.questionnaire.resourceType !== 'Questionnaire') {
        return `${path}.questionnaire must be a Questionnaire (resourceType="Questionnaire")`;
      }
    }
    return undefined;
  }

  return `${path}.kind must be selection.fhir or form.fhir`;
}

function validateArtifact(artifact: Record<string, unknown>, path: string): string | undefined {
  if (artifact.mediaType === SMART_HEALTH_CARD_MEDIA_TYPE) {
    if (artifact.fhirVersion !== undefined) return `${path}.fhirVersion must not be present for ${SMART_HEALTH_CARD_MEDIA_TYPE}`;
    const value = artifact.value;
    if (!isRecord(value) || !stringArray(value.verifiableCredential, true)) {
      return `${path}.value.verifiableCredential must be a non-empty string array`;
    }
    return undefined;
  }

  if (artifact.mediaType === FHIR_JSON_MEDIA_TYPE) {
    if (!nonEmptyString(artifact.fhirVersion)) return `${path}.fhirVersion missing or not a string`;
    if (!isRecord(artifact.value) || !nonEmptyString(artifact.value.resourceType)) {
      return `${path}.value must be a FHIR resource object with resourceType`;
    }
    return undefined;
  }

  return `${path}.mediaType "${String(artifact.mediaType)}" is not a recognized SMART Health Check-in 1.0 artifact type`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function stringArray(value: unknown, nonEmpty = false): value is string[] {
  return Array.isArray(value) && (!nonEmpty || value.length > 0) && value.every((item) => typeof item === 'string' && item.length > 0);
}
