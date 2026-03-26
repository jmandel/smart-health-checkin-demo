import React, { useState } from 'react';

type AnyObject = Record<string, unknown>;

function ResourceCard({ credentialId, resource }: { credentialId: string; resource: unknown }) {
  // Handle non-object data (strings like SHL links, SHC JWS tokens)
  if (typeof resource === 'string') {
    const truncated = resource.length > 120 ? resource.slice(0, 120) + '...' : resource;
    return (
      <div className="resource-card">
        <div className="resource-type">{credentialId}</div>
        <div className="resource-fields">
          <div className="resource-raw">{truncated}</div>
        </div>
      </div>
    );
  }

  if (!resource || typeof resource !== 'object') {
    return (
      <div className="resource-card">
        <div className="resource-type">{credentialId}</div>
        <div className="resource-fields">
          <pre className="resource-json">{JSON.stringify(resource, null, 2)}</pre>
        </div>
      </div>
    );
  }

  const obj = resource as AnyObject;
  const resourceType = obj.resourceType as string | undefined;

  // Typed renderers for known FHIR resources
  if (resourceType === 'Coverage') {
    const payor = (obj.payor as Array<{ display?: string }> | undefined)?.[0]?.display;
    const classes = obj.class as Array<{ type?: { coding?: Array<{ code?: string }> }; value?: string }> | undefined;
    const group = classes?.find(c => c.type?.coding?.[0]?.code === 'group');
    return (
      <div className="resource-card resource-coverage">
        <div className="resource-type">Coverage</div>
        <div className="resource-fields">
          <Field label="Member ID" value={obj.subscriberId as string} />
          <Field label="Payor" value={payor} />
          {group && <Field label="Group" value={group.value} />}
          {obj.status && <Field label="Status" value={obj.status as string} />}
        </div>
      </div>
    );
  }

  if (resourceType === 'Patient') {
    const names = obj.name as Array<{ text?: string; family?: string; given?: string[] }> | undefined;
    const name = names?.[0]?.text || [names?.[0]?.given?.join(' '), names?.[0]?.family].filter(Boolean).join(' ');
    return (
      <div className="resource-card resource-patient">
        <div className="resource-type">Patient</div>
        <div className="resource-fields">
          {name && <Field label="Name" value={name} />}
          {obj.birthDate && <Field label="Date of Birth" value={obj.birthDate as string} />}
          {obj.gender && <Field label="Gender" value={obj.gender as string} />}
        </div>
      </div>
    );
  }

  if (resourceType === 'QuestionnaireResponse') {
    const items = obj.item as Array<{ linkId: string; text?: string; answer?: Array<{ valueString?: string; valueBoolean?: boolean; valueDate?: string }> }> | undefined;
    return (
      <div className="resource-card resource-questionnaire">
        <div className="resource-type">QuestionnaireResponse</div>
        <div className="resource-fields">
          {obj.status && <Field label="Status" value={obj.status as string} />}
          {items?.map(item => {
            const answer = item.answer?.[0];
            const val = answer?.valueString ?? answer?.valueDate ?? (answer?.valueBoolean != null ? String(answer.valueBoolean) : undefined);
            return <Field key={item.linkId} label={item.text || `Item ${item.linkId}`} value={val} />;
          })}
        </div>
      </div>
    );
  }

  // Generic fallback for any FHIR resource or unknown object
  return (
    <div className="resource-card">
      <div className="resource-type">{resourceType || credentialId}</div>
      <div className="resource-fields">
        {resourceType && obj.id && <Field label="ID" value={obj.id as string} />}
        {obj.status && <Field label="Status" value={obj.status as string} />}
        <GenericFields obj={obj} skip={['resourceType', 'id', 'status', 'meta']} />
      </div>
    </div>
  );
}

function GenericFields({ obj, skip }: { obj: AnyObject; skip: string[] }) {
  const entries = Object.entries(obj).filter(([k]) => !skip.includes(k));
  if (entries.length === 0) return null;

  return (
    <details className="resource-details">
      <summary>Details ({entries.length} fields)</summary>
      <pre className="resource-json">{JSON.stringify(Object.fromEntries(entries), null, 2)}</pre>
    </details>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="resource-field">
      <span className="resource-field-label">{label}</span>
      <span className="resource-field-value">{value}</span>
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

  const resp = response as { credentials?: Record<string, unknown[]>; vp_token?: object; state?: string } | null;
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
                <ResourceCard key={`${id}-${i}`} credentialId={id} resource={item} />
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
