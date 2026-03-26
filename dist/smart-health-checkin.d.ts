/**
 * SMART Health Check-in Client Library
 * OID4VP profile for browser-based health data sharing
 * Uses direct_post.jwt with ephemeral keys to a zero-trust relay for E2E encryption
 */
export interface CredentialQuery {
    id: string;
    format: 'smart_artifact';
    require_cryptographic_holder_binding?: boolean;
    meta: {
        profile?: string;
        questionnaire?: object;
        questionnaireUrl?: string;
        signing_strategy?: string[];
    };
}
export interface CredentialSet {
    options: string[][];
    required: boolean;
}
export interface DCQLQuery {
    credentials: CredentialQuery[];
    credential_sets?: CredentialSet[];
}
/**
 * Artifact type identifiers for credential data
 * - "fhir_resource": A FHIR resource object (e.g., Coverage, Patient)
 * - "shc": A SMART Health Card (compact JWS format)
 * - "shl": A SMART Health Link (shlink:/ URI)
 */
export type ArtifactType = 'fhir_resource' | 'shc' | 'shl';
export interface FullArtifactPresentation {
    type: ArtifactType;
    data: unknown;
    artifact_id?: string;
}
export interface RefArtifactPresentation {
    artifact_ref: string;
}
export type Presentation = FullArtifactPresentation | RefArtifactPresentation;
export interface VPToken {
    [credentialId: string]: Presentation[];
}
export interface RawResponse {
    state: string;
    vp_token: VPToken;
}
export interface RehydratedResponse extends RawResponse {
    credentials: {
        [credentialId: string]: unknown[];
    };
}
export interface ClientMetadata {
    jwks: {
        keys: object[];
    };
    encrypted_response_enc_values_supported: string[];
}
export interface RequestOptions {
    /** URL of the health app picker/check-in page */
    checkinBase: string;
    /** Base URL of the zero-trust relay server */
    relayUrl: string;
    /** Callback invoked when OID4VP request is constructed */
    onRequestStart?: (params: OID4VPRequestParams) => void;
    /** If true (default), response includes rehydrated credentials object */
    rehydrate?: boolean;
    /** Request timeout in milliseconds (default: 120000) */
    timeout?: number;
}
export interface OID4VPRequestParams {
    client_id: string;
    response_type: 'vp_token';
    response_mode: 'direct_post.jwt';
    response_uri: string;
    client_metadata: ClientMetadata;
    state: string;
    nonce: string;
    dcql_query: DCQLQuery;
}
export interface SHLError extends Error {
    code: string;
    state: string;
}
/**
 * Rehydrate vp_token by resolving inline references to actual data.
 * Two-pass resolution: catalog artifact_ids, then resolve artifact_refs.
 */
export declare function rehydrateResponse(response: RawResponse): RehydratedResponse;
/**
 * Initiate a SMART Health Check-in credential request
 * Uses direct_post.jwt with ephemeral keys and a zero-trust relay
 */
export declare function request(dcqlQuery: DCQLQuery, opts: RequestOptions): Promise<RawResponse | RehydratedResponse>;
/**
 * Handle return context in popup window.
 * With direct_post.jwt, data flows through the relay, not the fragment.
 * This function is retained for popup cleanup only.
 */
export declare function maybeHandleReturn(): Promise<boolean>;
declare global {
    interface Window {
        SHL?: {
            request: typeof request;
            maybeHandleReturn: typeof maybeHandleReturn;
            rehydrateResponse: typeof rehydrateResponse;
        };
    }
}
//# sourceMappingURL=smart-health-checkin.d.ts.map