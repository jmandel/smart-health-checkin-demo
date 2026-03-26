import React from 'react';

export function TransactionBrowser({ request: req, response }: { request: object | null; response: object | null }) {
  if (!req && !response) return null;

  return (
    <div className="transaction-browser">
      <div className="browser-section">
        <div className="browser-header">Request (OID4VP Bootstrap)</div>
        <pre className="browser-content">{JSON.stringify(req, null, 2)}</pre>
      </div>
      <div className="browser-section">
        <div className="browser-header">Response (OID4VP)</div>
        <pre className="browser-content">{JSON.stringify(response, null, 2)}</pre>
      </div>
    </div>
  );
}
