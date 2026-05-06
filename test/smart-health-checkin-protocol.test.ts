import { describe, expect, test } from 'bun:test';
import { decodeJwt, generateKeyPair, exportJWK } from 'jose';
import { createRelayHandler } from '../demo/relay/handler';
import {
  FHIR_JSON_MEDIA_TYPE,
  SMART_HEALTH_CHECKIN_CREDENTIAL_ID,
  SMART_HEALTH_CHECKIN_FORMAT,
  buildSmartHealthCheckinDCQLQuery,
  extractSmartHealthCheckinResponse,
  validateResponseAgainstRequest,
  validateSmartHealthCheckinRequest,
  type SmartHealthCheckinRequest,
  type SmartHealthCheckinResponse,
} from '../src/smart-health-checkin-protocol';

const SMART_REQUEST: SmartHealthCheckinRequest = {
  type: 'smart-health-checkin-request',
  version: '1',
  id: 'test-checkin-request',
  purpose: 'Clinic check-in',
  fhirVersions: ['4.0.1'],
  items: [
    {
      id: 'patient',
      title: 'Patient demographics',
      summary: 'Demographics for check-in.',
      required: true,
      content: {
        kind: 'selection.fhir',
        profiles: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'],
      },
      accept: [FHIR_JSON_MEDIA_TYPE],
    },
    {
      id: 'intake',
      title: 'Intake form',
      content: {
        kind: 'form.fhir',
        questionnaireCanonical: 'https://example.org/fhir/Questionnaire/intake',
      },
      accept: [FHIR_JSON_MEDIA_TYPE],
    },
  ],
};

describe('SMART clinical request validation', () => {
  test('accepts exact request item and selector semantics', () => {
    expect(validateSmartHealthCheckinRequest(SMART_REQUEST).ok).toBe(true);
    expect(buildSmartHealthCheckinDCQLQuery(SMART_REQUEST)).toEqual({
      credentials: [
        {
          id: SMART_HEALTH_CHECKIN_CREDENTIAL_ID,
          format: SMART_HEALTH_CHECKIN_FORMAT,
          require_cryptographic_holder_binding: false,
          meta: { request: SMART_REQUEST },
        },
      ],
    });
  });

  test('rejects malformed request item shapes', () => {
    expect(validateSmartHealthCheckinRequest({ ...SMART_REQUEST, type: 'wrong' }).ok).toBe(false);
    expect(validateSmartHealthCheckinRequest({
      ...SMART_REQUEST,
      items: [{ ...SMART_REQUEST.items[0], title: '' }],
    }).ok).toBe(false);
    expect(validateSmartHealthCheckinRequest({
      ...SMART_REQUEST,
      items: [{ ...SMART_REQUEST.items[0], accept: [] }],
    }).ok).toBe(false);
    expect(validateSmartHealthCheckinRequest({
      ...SMART_REQUEST,
      items: [{ ...SMART_REQUEST.items[0], content: { kind: 'selection.fhir', profilesFrom: 'http://hl7.org/fhir/us/core' } }],
    }).ok).toBe(false);
    expect(validateSmartHealthCheckinRequest({
      ...SMART_REQUEST,
      items: [{ ...SMART_REQUEST.items[0], content: { kind: 'form.fhir' } }],
    }).ok).toBe(false);
  });
});

describe('SMART clinical response validation', () => {
  test('cross-validates requestId, fulfills, statuses, mediaType, and FHIR version', () => {
    const response: SmartHealthCheckinResponse = {
      type: 'smart-health-checkin-response',
      version: '1',
      requestId: SMART_REQUEST.id,
      artifacts: [
        {
          id: 'artifact-patient',
          mediaType: FHIR_JSON_MEDIA_TYPE,
          fhirVersion: '4.0.1',
          fulfills: ['patient'],
          value: { resourceType: 'Patient', id: 'p1' },
        },
      ],
      requestStatus: [
        { item: 'patient', status: 'fulfilled' },
        { item: 'intake', status: 'declined' },
      ],
    };

    expect(validateResponseAgainstRequest(SMART_REQUEST, response).ok).toBe(true);
    expect(validateResponseAgainstRequest(SMART_REQUEST, { ...response, requestId: 'wrong' }).ok).toBe(false);
    expect(validateResponseAgainstRequest(SMART_REQUEST, {
      ...response,
      artifacts: [{ ...response.artifacts[0], fulfills: ['missing'] }],
    }).ok).toBe(false);
    expect(validateResponseAgainstRequest(SMART_REQUEST, {
      ...response,
      requestStatus: [{ item: 'patient', status: 'fulfilled' }],
    }).ok).toBe(false);
    expect(validateResponseAgainstRequest(SMART_REQUEST, {
      ...response,
      artifacts: [{ ...response.artifacts[0], fhirVersion: '5.0.0' }],
    }).ok).toBe(false);

    expect(extractSmartHealthCheckinResponse({ [SMART_HEALTH_CHECKIN_CREDENTIAL_ID]: [response] }).ok).toBe(true);
    expect(extractSmartHealthCheckinResponse({ [SMART_HEALTH_CHECKIN_CREDENTIAL_ID]: response }).ok).toBe(false);
  });
});

describe('OID4VP Request Object profile wrapper', () => {
  test('embeds SMART request in DCQL meta.request and omits clinical completion hints', async () => {
    const { handler } = await createRelayHandler({
      wellKnownClientUrl: 'https://clinic.example.test',
      allowedSameDeviceOrigins: ['https://app.example.test'],
    });
    const { publicKey } = await generateKeyPair('ECDH-ES', { crv: 'P-256', extractable: true });
    const ephemeral_pub_jwk = await exportJWK(publicKey);

    const initResponse = await handler(new Request('https://clinic.example.test/oid4vp/same-device/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uri: 'https://app.example.test/checkin/return',
        ephemeral_pub_jwk,
        smart_health_checkin_request: SMART_REQUEST,
      }),
    }));
    expect(initResponse?.ok).toBe(true);
    const init = await initResponse!.json() as {
      request_uri: string;
      request_object_claims: Record<string, unknown>;
    };
    expect(init.request_object_claims.smart_health_checkin).toBeUndefined();
    expect(init.request_object_claims.redirect_uri).toBeUndefined();
    expect(init.request_object_claims.dcql_query).toEqual(buildSmartHealthCheckinDCQLQuery(SMART_REQUEST));

    const requestObjectResponse = await handler(new Request(init.request_uri));
    expect(requestObjectResponse?.ok).toBe(true);
    const requestObjectJwt = await requestObjectResponse!.text();
    const payload = decodeJwt(requestObjectJwt) as Record<string, unknown>;

    expect(payload.smart_health_checkin).toBeUndefined();
    expect(payload.redirect_uri).toBeUndefined();
    expect(payload.dcql_query).toEqual(buildSmartHealthCheckinDCQLQuery(SMART_REQUEST));
  });
});
