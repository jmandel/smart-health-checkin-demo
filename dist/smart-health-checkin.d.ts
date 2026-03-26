/**
 * SMART Health Check-in Client Library
 * OID4VP profile for browser-based health data sharing
 *
 * Uses well_known: client identifier prefix, signed Request Objects,
 * direct_post.jwt with ephemeral keys, and a verifier-controlled response endpoint.
 * Supports same-device (popup) and cross-device (QR) flows.
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
    /** Bare HTTPS origin of the Verifier */
    verifierBase: string;
    /** Flow mode: same-device (popup) or cross-device (QR) */
    flow?: 'same-device' | 'cross-device';
    /** Callback invoked when OID4VP request is constructed */
    onRequestStart?: (info: RequestStartInfo) => void;
    /** If true (default), response includes rehydrated credentials object */
    rehydrate?: boolean;
    /** Request timeout in milliseconds (default: 120000) */
    timeout?: number;
}
export interface RequestStartInfo {
    flow: 'same-device' | 'cross-device';
    /** The protocol-level bootstrap request (what the wallet/picker sees) */
    bootstrap: {
        client_id: string;
        request_uri: string;
        request_uri_method: string;
    };
    /** Full launch URL including bootstrap params */
    launch_url: string;
    /** Shim-internal transaction state (not sent to wallet) */
    transaction: {
        transaction_id: string;
        request_id: string;
        read_secret: string;
    };
}
export interface SHLError extends Error {
    code: string;
    state: string;
}
export declare function rehydrateResponse(response: RawResponse): RehydratedResponse;
/**
 * Initiate a SMART Health Check-in credential request.
 */
export declare function request(dcqlQuery: DCQLQuery, opts: RequestOptions): Promise<RawResponse | RehydratedResponse>;
/**
 * Handle return context in popup window.
 * Detects #response_code in the hash, signals the opener via postMessage.
 */
export declare function maybeHandleReturn(): Promise<boolean>;
declare global {
    interface Window {
        SmartHealthCheckin?: {
            request: typeof request;
            maybeHandleReturn: typeof maybeHandleReturn;
            rehydrateResponse: typeof rehydrateResponse;
        };
    }
}
//# sourceMappingURL=smart-health-checkin.d.ts.map