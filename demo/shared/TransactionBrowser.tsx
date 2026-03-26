import React, { useState } from 'react';

interface Credential {
  resourceType?: string;
  [key: string]: unknown;
}

function ResourceCard({ resource }: { resource: Credential }) {
  if (!resource.resourceType) return null;

  if (resource.resourceType === 'Coverage') {
    const cov = resource as {
      resourceType: string;
      subscriberId?: string;
      payor?: Array<{ display?: string }>;
      class?: Array<{ type?: { coding?: Array<{ code?: string }> }; value?: string }>;
    };
    const group = cov.class?.find(c => c.type?.coding?.[0]?.code === 'group');
    return (
      <div className="resource-card resource-coverage">
        <div className="resource-type">Coverage</div>
        <div className="resource-fields">
          <Field label="Member ID" value={cov.subscriberId} />
          <Field label="Payor" value={cov.payor?.[0]?.display} />
          <Field label="Group" value={group?.value} />
        </div>
      </div>
    );
  }

  if (resource.resourceType === 'Patient') {
    const pt = resource as {
      resourceType: string;
      name?: Array<{ text?: string }>;
      birthDate?: string;
    };
    return (
      <div className="resource-card resource-patient">
        <div className="resource-type">Patient</div>
        <div className="resource-fields">
          <Field label="Name" value={pt.name?.[0]?.text} />
          <Field label="Date of Birth" value={pt.birthDate} />
        </div>
      </div>
    );
  }

  if (resource.resourceType === 'QuestionnaireResponse') {
    const qr = resource as {
      resourceType: string;
      status?: string;
      item?: Array<{ linkId: string; answer?: Array<{ valueString?: string }> }>;
    };
    return (
      <div className="resource-card resource-questionnaire">
        <div className="resource-type">QuestionnaireResponse</div>
        <div className="resource-fields">
          <Field label="Status" value={qr.status} />
          {qr.item?.map(item => (
            <Field key={item.linkId} label={`Item ${item.linkId}`} value={item.answer?.[0]?.valueString} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="resource-card">
      <div className="resource-type">{resource.resourceType}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="resource-field">
      <span className="resource-field-label">{label}</span>
      <span className="resource-field-value">{value || '—'}</span>
    </div>
  );
}

function CollapsibleJson({ title, data }: { title: string; data: object | null }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;

  return (
    <div className="collapsible-json">
      <div className="collapsible-header" onClick={() => setOpen(!open)}>
        <span className="collapsible-arrow">{open ? '▾' : '▸'}</span>
        {title}
      </div>
      {open && (
        <pre className="collapsible-content">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

export function TransactionBrowser({ request: req, response }: { request: object | null; response: object | null }) {
  if (!req && !response) return null;

  const resp = response as { credentials?: Record<string, Credential[]>; vp_token?: object; state?: string } | null;
  const credentials = resp?.credentials;
  const wireResponse = resp?.vp_token ? { state: resp.state, vp_token: resp.vp_token } : null;

  return (
    <div className="transaction-browser">
      {credentials && (
        <div className="browser-section">
          <div className="browser-header">Received Credentials</div>
          <div className="credentials-grid">
            {Object.entries(credentials).map(([id, items]) =>
              items.map((item, i) => (
                <ResourceCard key={`${id}-${i}`} resource={item as Credential} />
              ))
            )}
          </div>
        </div>
      )}

      <CollapsibleJson title="OID4VP Bootstrap Request" data={req} />
      <CollapsibleJson title="Wire Response (vp_token)" data={wireResponse} />
    </div>
  );
}
