import React, { useState } from 'react';

type AnyObject = Record<string, unknown>;
type CodeableConcept = {
  text?: string;
  coding?: Array<{ system?: string; code?: string; display?: string }>;
};
type Money = {
  value?: number;
  currency?: string;
  unit?: string;
};
type Extension = {
  url?: string;
  extension?: Extension[];
  valueString?: string;
  valueDate?: string;
  valueAttachment?: { contentType?: string; data?: string; url?: string };
  valueAnnotation?: { text?: string };
  valueReference?: { reference?: string; display?: string };
};
type CoverageClass = {
  type?: CodeableConcept;
  value?: string;
  name?: string;
};
type PlanCost = {
  type?: CodeableConcept;
  cost?: Money;
  comment?: string;
};
type SpecificCost = {
  category?: CodeableConcept;
  benefit?: Array<{
    type?: CodeableConcept;
    cost?: Array<{
      type?: CodeableConcept;
      applicability?: CodeableConcept;
      value?: Money;
      qualifiers?: Array<{ text?: string }>;
    }>;
  }>;
};
type CardImage = {
  label: string;
  contentType: string;
  data: string;
};
type QRAnswer = {
  valueString?: string;
  valueBoolean?: boolean;
  valueDate?: string;
  valueInteger?: number;
  valueDecimal?: number;
  valueCoding?: { code?: string; display?: string };
};
type QRItem = {
  linkId: string;
  text?: string;
  answer?: QRAnswer[];
  item?: QRItem[];
};
type BundleEntry = {
  fullUrl?: string;
  resource?: AnyObject;
};
type Reaction = {
  manifestation?: CodeableConcept[];
  severity?: string;
};

function codeText(concept?: CodeableConcept): string | undefined {
  return concept?.text || concept?.coding?.[0]?.display || concept?.coding?.[0]?.code;
}

function moneyText(money?: Money): string | undefined {
  if (money?.value == null) return undefined;
  const unit = money.currency || money.unit || 'USD';
  if (unit === 'USD') return `$${money.value.toLocaleString()}`;
  if (unit === '%') return `${money.value}%`;
  return `${money.value.toLocaleString()} ${unit}`;
}

function coverageClass(classes: CoverageClass[] | undefined, code: string): CoverageClass | undefined {
  return classes?.find(item => item.type?.coding?.some(coding => coding.code === code));
}

function rootExtension(obj: AnyObject, suffix: string): Extension | undefined {
  return (obj.extension as Extension[] | undefined)?.find(ext => ext.url?.endsWith(suffix));
}

function rootExtensions(obj: AnyObject, suffix: string): Extension[] {
  return (obj.extension as Extension[] | undefined)?.filter(ext => ext.url?.endsWith(suffix)) || [];
}

function extensionChild(extension: Extension, url: string): Extension | undefined {
  return extension.extension?.find(child => child.url === url);
}

function supportingImages(obj: AnyObject): CardImage[] {
  return rootExtensions(obj, 'C4DIC-SupportingImage-extension').flatMap(ext => {
    const label = extensionChild(ext, 'label')?.valueString || 'Insurance card image';
    const image = extensionChild(ext, 'image')?.valueAttachment;
    if (!image?.contentType || !image.data) return [];
    return [{ label, contentType: image.contentType, data: image.data }];
  });
}

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
    const classes = obj.class as CoverageClass[] | undefined;
    const group = coverageClass(classes, 'group');
    const plan = coverageClass(classes, 'plan');
    const network = coverageClass(classes, 'network');
    const cardIssueDate = rootExtension(obj, 'C4DIC-CardIssueDate-extension')?.valueDate;
    const sbcReference = rootExtensions(obj, 'C4DIC-AdditionalCardInformation-extension')
      .map(ext => ext.valueReference?.display || ext.valueReference?.reference)
      .find(Boolean);
    const images = supportingImages(obj);
    return (
      <div className="resource-card resource-coverage">
        <div className="resource-type">Coverage</div>
        <div className="resource-fields">
          <Field label="Member ID" value={obj.subscriberId as string} />
          <Field label="Payor" value={payor} />
          <Field label="Plan" value={plan?.name || plan?.value} />
          {group && <Field label="Group" value={group.value} />}
          <Field label="Network" value={network?.name || network?.value} />
          <Field label="Card Issued" value={cardIssueDate} />
          <Field label="SBC" value={sbcReference} />
          {obj.status && <Field label="Status" value={obj.status as string} />}
          <CardImages images={images} />
        </div>
      </div>
    );
  }

  if (resourceType === 'InsurancePlan') {
    const plan = (obj.plan as Array<{
      type?: CodeableConcept;
      generalCost?: PlanCost[];
      specificCost?: SpecificCost[];
    }> | undefined)?.[0];
    const period = obj.period as { start?: string; end?: string } | undefined;
    const payer = (obj.ownedBy as { display?: string } | undefined)?.display;
    const planType = codeText(plan?.type);
    return (
      <div className="resource-card resource-plan">
        <div className="resource-type">InsurancePlan</div>
        <div className="resource-fields">
          <Field label="Plan" value={obj.name as string} />
          <Field label="Type" value={planType} />
          <Field label="Payer" value={payer} />
          <Field label="Period" value={[period?.start, period?.end].filter(Boolean).join(' to ')} />
          <PlanCosts costs={plan?.generalCost || []} />
          <SpecificCosts costs={plan?.specificCost || []} />
        </div>
      </div>
    );
  }

  if (resourceType === 'Bundle') {
    const entries = (obj.entry as BundleEntry[] | undefined) || [];
    return (
      <div className="resource-card resource-bundle">
        <div className="resource-type">Clinical History Bundle</div>
        <div className="resource-fields">
          <Field label="Bundle Type" value={obj.type as string} />
          <Field label="Entries" value={entries.length} />
          <BundleEntries entries={entries} />
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

  if (resourceType === 'AllergyIntolerance') {
    return (
      <div className="resource-card resource-allergy">
        <div className="resource-type">AllergyIntolerance</div>
        <div className="resource-fields">
          <AllergyFields resource={obj} />
        </div>
      </div>
    );
  }

  if (resourceType === 'Condition') {
    return (
      <div className="resource-card resource-condition">
        <div className="resource-type">Condition</div>
        <div className="resource-fields">
          <ConditionFields resource={obj} />
        </div>
      </div>
    );
  }

  if (resourceType === 'QuestionnaireResponse') {
    const items = obj.item as QRItem[] | undefined;
    return (
      <div className="resource-card resource-questionnaire">
        <div className="resource-type">QuestionnaireResponse</div>
        <div className="resource-fields">
          <QuestionnaireResponseFields items={items || []} />
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

function CardImages({ images }: { images: CardImage[] }) {
  if (!images.length) return null;
  return (
    <div className="card-image-grid">
      {images.map(image => (
        <figure key={image.label} className="card-image">
          <img src={`data:${image.contentType};base64,${image.data}`} alt={image.label} />
          <figcaption>{image.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function PlanCosts({ costs }: { costs: PlanCost[] }) {
  if (!costs.length) return null;
  return (
    <div className="plan-cost-grid">
      {costs.slice(0, 4).map(cost => (
        <div key={codeText(cost.type)} className="plan-cost">
          <span>{codeText(cost.type)}</span>
          <strong>{moneyText(cost.cost)}</strong>
        </div>
      ))}
    </div>
  );
}

function SpecificCosts({ costs }: { costs: SpecificCost[] }) {
  if (!costs.length) return null;
  return (
    <div className="specific-cost-list">
      {costs.slice(0, 5).map(cost => {
        const firstCost = cost.benefit?.[0]?.cost?.[0];
        const label = codeText(cost.category) || codeText(cost.benefit?.[0]?.type);
        const amount = firstCost?.type?.text === 'No charge' ? 'No charge' : moneyText(firstCost?.value);
        const note = firstCost?.qualifiers?.[0]?.text;
        return (
          <div key={label} className="specific-cost">
            <span>{label}</span>
            <strong>{[amount, note].filter(Boolean).join(' - ')}</strong>
          </div>
        );
      })}
    </div>
  );
}

function BundleEntries({ entries }: { entries: BundleEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="bundle-entry-list">
      {entries.map((entry, index) => {
        const resource = entry.resource || {};
        const resourceType = resource.resourceType as string | undefined;
        return (
          <div key={entry.fullUrl || `${resourceType}-${index}`} className="bundle-entry">
            <div className="bundle-entry-type">{resourceType || 'Resource'}</div>
            <BundleResourceSummary resource={resource} />
          </div>
        );
      })}
    </div>
  );
}

function BundleResourceSummary({ resource }: { resource: AnyObject }) {
  const resourceType = resource.resourceType as string | undefined;
  if (resourceType === 'Patient') {
    const names = resource.name as Array<{ text?: string; family?: string; given?: string[] }> | undefined;
    const name = names?.[0]?.text || [names?.[0]?.given?.join(' '), names?.[0]?.family].filter(Boolean).join(' ');
    return (
      <>
        <Field label="Name" value={name} />
        <Field label="Date of Birth" value={resource.birthDate as string} />
      </>
    );
  }
  if (resourceType === 'AllergyIntolerance') return <AllergyFields resource={resource} />;
  if (resourceType === 'Condition') return <ConditionFields resource={resource} />;
  return <Field label="ID" value={resource.id as string} />;
}

function AllergyFields({ resource }: { resource: AnyObject }) {
  const reactions = resource.reaction as Reaction[] | undefined;
  const reaction = reactions?.[0];
  return (
    <>
      <Field label="Substance" value={codeText(resource.code as CodeableConcept | undefined)} />
      <Field label="Status" value={codeText(resource.clinicalStatus as CodeableConcept | undefined)} />
      <Field label="Reaction" value={reaction?.manifestation?.map(codeText).filter(Boolean).join(', ')} />
      <Field label="Severity" value={reaction?.severity} />
    </>
  );
}

function ConditionFields({ resource }: { resource: AnyObject }) {
  return (
    <>
      <Field label="Problem" value={codeText(resource.code as CodeableConcept | undefined)} />
      <Field label="Status" value={codeText(resource.clinicalStatus as CodeableConcept | undefined)} />
      <Field label="Onset" value={resource.onsetDateTime as string} />
    </>
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

function formatQuestionnaireAnswer(answer: QRAnswer): string | undefined {
  if (answer.valueCoding) return answer.valueCoding.display || answer.valueCoding.code;
  if (answer.valueString != null) return answer.valueString;
  if (answer.valueDate != null) return answer.valueDate;
  if (answer.valueInteger != null) return String(answer.valueInteger);
  if (answer.valueDecimal != null) return String(answer.valueDecimal);
  if (answer.valueBoolean != null) return answer.valueBoolean ? 'Yes' : 'No';
  return undefined;
}

function QuestionnaireResponseFields({ items, depth = 0 }: { items: QRItem[]; depth?: number }) {
  return (
    <>
      {items.map(item => {
        const label = item.text || `Item ${item.linkId}`;
        const value = item.answer?.map(formatQuestionnaireAnswer).filter(Boolean).join(', ');
        if (item.item?.length) {
          return (
            <div key={item.linkId} className="resource-group" style={{ marginLeft: depth ? 8 : 0 }}>
              <div className="resource-group-label">{label}</div>
              <QuestionnaireResponseFields items={item.item} depth={depth + 1} />
            </div>
          );
        }
        if (!value) {
          return <div key={item.linkId} className="resource-note"><MarkdownText text={label} /></div>;
        }
        return <Field key={item.linkId} label={label} value={value} />;
      })}
    </>
  );
}

function MarkdownText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
        if (!match) return <React.Fragment key={i}>{part}</React.Fragment>;
        return (
          <a key={i} href={match[2]} target="_blank" rel="noreferrer">
            {match[1]}
          </a>
        );
      })}
    </>
  );
}

function Field({ label, value }: { label: string; value?: string | number | boolean }) {
  if (value == null || value === '') return null;
  return (
    <div className="resource-field">
      <span className="resource-field-label">{label}</span>
      <span className="resource-field-value">{String(value)}</span>
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

interface RequestInfo {
  flow?: string;
  bootstrap?: { client_id?: string; request_uri?: string; request_uri_method?: string };
  launch_url?: string;
  transaction?: object;
  [key: string]: unknown;
}

function decodeJwtPayload(jwt: string): { header: object; payload: object } | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const decode = (s: string) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
    return { header: decode(parts[0]), payload: decode(parts[1]) };
  } catch {
    return null;
  }
}

function SignedRequestPanel({ requestUri }: { requestUri: string }) {
  const [jwt, setJwt] = useState<{ raw: string; header: object; payload: object } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetched = React.useRef(false);

  React.useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetch(requestUri)
      .then(r => r.text())
      .then(raw => {
        const decoded = decodeJwtPayload(raw);
        if (decoded) setJwt({ raw, ...decoded });
        else setError('Could not decode JWT');
      })
      .catch(e => setError(e.message));
  }, [requestUri]);

  if (error) return null;
  if (!jwt) return null;

  return (
    <>
      <CollapsibleJson title="Signed Request Object — JWT Header" data={jwt.header} />
      <CollapsibleJson title="Signed Request Object — JWT Payload (claims)" data={jwt.payload} />
    </>
  );
}

export function TransactionBrowser({
  request: req,
  response,
  showCredentials = true
}: {
  request: object | null;
  response: object | null;
  showCredentials?: boolean;
}) {
  if (!req && !response) return null;

  const reqInfo = req as RequestInfo | null;
  const resp = response as { credentials?: Record<string, unknown[]>; vp_token?: object; state?: string } | null;
  const credentials = resp?.credentials;
  const wireResponse = resp?.vp_token ? { state: resp.state, vp_token: resp.vp_token } : null;
  const requestUri = reqInfo?.bootstrap?.request_uri;

  return (
    <div className="transaction-browser">
      {showCredentials && credentials && (
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

      <CollapsibleJson title="Bootstrap Request (sent to wallet/picker)" data={reqInfo?.bootstrap || null} />
      {requestUri && <SignedRequestPanel requestUri={requestUri} />}
      <CollapsibleJson title="Shim Transaction (internal, not sent to wallet)" data={reqInfo?.transaction || null} />
      <CollapsibleJson title="Wire Response (vp_token)" data={wireResponse} />
    </div>
  );
}
