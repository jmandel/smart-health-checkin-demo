/**
 * SMART Health Check-in Client Library
 * OID4VP profile for browser-based health data sharing
 */
export interface CredentialQuery {
    id: string;
    format: 'smart_artifact';
    optional?: boolean;
    require_cryptographic_holder_binding?: boolean;
    meta: {
        profile?: string;
        questionnaire?: object;
        questionnaireUrl?: string;
        signing_strategy?: string[];
    };
}
export interface DCQLQuery {
    credentials: CredentialQuery[];
}
/**
 * Artifact type identifiers for credential data
 * - "fhir_resource": A FHIR resource object (e.g., Coverage, Patient)
 * - "shc": A SMART Health Card (compact JWS format)
 * - "shl": A SMART Health Link (shlink:/ URI)
 */
export type ArtifactType = 'fhir_resource' | 'shc' | 'shl';
export interface Artifact {
    type: ArtifactType;
    data: unknown;
}
export interface Presentation {
    artifact: number;
}
export interface VPToken {
    [credentialId: string]: Presentation[];
}
export interface RawResponse {
    state: string;
    vp_token: VPToken;
    smart_artifacts: Artifact[];
}
export interface RehydratedResponse extends RawResponse {
    credentials: {
        [credentialId: string]: unknown[];
    };
}
export interface RequestOptions {
    /** URL of the health app picker/check-in page */
    checkinBase: string;
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
    response_mode: 'fragment';
    state: string;
    nonce: string;
    dcql_query: DCQLQuery;
}
export interface SHLError extends Error {
    code: string;
    state: string;
}
export interface ParsedReturnSuccess {
    type: 'success';
    state: string;
    vp_token: VPToken;
    smart_artifacts: Artifact[];
}
export interface ParsedReturnError {
    type: 'error';
    state: string;
    error: string;
    error_description?: string;
}
export type ParsedReturn = ParsedReturnSuccess | ParsedReturnError | null;
export interface HandleReturnOptions {
    /** If false, skip rendering UI (just broadcast and return) */
    renderUI?: boolean;
}
/**
 * Parse URL hash for OID4VP return parameters
 * Pure function - no side effects
 */
export declare function parseReturnHash(hash: string): ParsedReturn;
/**
 * Broadcast response to waiting request via BroadcastChannel
 */
export declare function broadcastResponse(state: string, data: object): void;
/**
 * Rehydrate vp_token by resolving artifact indices to actual data
 */
export declare function rehydrateResponse(response: RawResponse): RehydratedResponse;
/**
 * Initiate a SMART Health Check-in credential request
 */
export declare function request(dcqlQuery: DCQLQuery, opts: RequestOptions): Promise<RawResponse | RehydratedResponse>;
/**
 * Render return UI in popup window
 */
export declare function renderReturnUI(success: boolean, message: string): void;
/**
 * Handle return context in popup window
 * Call on page load to detect and process OID4VP responses
 * @returns true if this was a return context
 */
export declare function maybeHandleReturn(opts?: HandleReturnOptions): Promise<boolean>;
declare global {
    interface Window {
        SHL?: {
            request: typeof request;
            maybeHandleReturn: typeof maybeHandleReturn;
            parseReturnHash: typeof parseReturnHash;
            rehydrateResponse: typeof rehydrateResponse;
        };
    }
}
//# sourceMappingURL=smart-health-checkin.d.ts.map