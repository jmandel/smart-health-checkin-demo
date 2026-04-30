/**
 * Shared hook for demo requester pages.
 * Wraps the SmartHealthCheckin.request() shim and manages UI state.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  completeSameDeviceRedirect,
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
  walletUrl: string;
  wellKnownClientUrl: string;
  flow: 'same-device' | 'cross-device';
  sameDeviceLaunch?: 'popup' | 'replace';
}) {
  const isReturnHandoff = typeof location !== 'undefined'
    && new URLSearchParams(location.search).has('shc_handoff')
    && new URLSearchParams(location.hash.substring(1)).has('response_code');
  const [state, setState] = useState<DemoRequestState>({
    loading: isReturnHandoff,
    complete: false,
    error: null,
    requestInfo: null,
    requestLog: null,
    responseLog: null,
    result: null,
  });

  useEffect(() => {
    if (opts.flow !== 'same-device') return;
    let mounted = true;

    completeSameDeviceRedirect()
      .then((completion) => {
        if (!completion || !mounted) return;
        const result = completion.response as RehydratedResponse;
        setState({
          loading: false,
          complete: true,
          error: null,
          requestInfo: completion.requestInfo,
          requestLog: completion.requestInfo,
          responseLog: result,
          result,
        });
      })
      .catch((err) => {
        if (!mounted) return;
        setState(s => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      });

    return () => { mounted = false; };
  }, [opts.flow]);

  const start = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null, requestInfo: null }));

    try {
      const result = await request(dcqlQuery, {
        walletUrl: opts.walletUrl,
        wellKnownClientUrl: opts.wellKnownClientUrl,
        flow: opts.flow,
        sameDeviceLaunch: opts.sameDeviceLaunch,
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
  }, [dcqlQuery, opts.walletUrl, opts.wellKnownClientUrl, opts.flow, opts.sameDeviceLaunch]);

  return { ...state, start };
}
