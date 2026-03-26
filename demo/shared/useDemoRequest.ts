/**
 * Shared hook for demo requester pages.
 * Wraps the SmartHealthCheckin.request() shim and manages UI state.
 */

import { useState, useCallback } from 'react';
import {
  request,
  type DCQLQuery,
  type RehydratedResponse,
  type RequestStartInfo,
} from 'smart-health-checkin';

export interface DemoRequestState {
  loading: boolean;
  complete: boolean;
  error: string | null;
  requestInfo: RequestStartInfo | null;
  requestLog: object | null;
  responseLog: object | null;
  result: RehydratedResponse | null;
}

export function useDemoRequest(dcqlQuery: DCQLQuery, opts: {
  checkinBase: string;
  verifierBase: string;
  flow: 'same-device' | 'cross-device';
}) {
  const [state, setState] = useState<DemoRequestState>({
    loading: false,
    complete: false,
    error: null,
    requestInfo: null,
    requestLog: null,
    responseLog: null,
    result: null,
  });

  const start = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null, requestInfo: null }));

    try {
      const result = await request(dcqlQuery, {
        checkinBase: opts.checkinBase,
        verifierBase: opts.verifierBase,
        flow: opts.flow,
        onRequestStart: (info) => {
          setState(s => ({
            ...s,
            requestInfo: info,
            requestLog: info,
            responseLog: { status: 'Waiting for response...' },
          }));
        },
      }) as RehydratedResponse;

      setState(s => ({
        ...s,
        loading: false,
        complete: true,
        result,
        responseLog: result,
      }));
    } catch (err) {
      setState(s => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, [dcqlQuery, opts.checkinBase, opts.verifierBase, opts.flow]);

  return { ...state, start };
}
