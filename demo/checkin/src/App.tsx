import React, { useMemo } from 'react';
import { config } from '../../config';
import './styles.css';

interface AppConfig {
  id: string;
  name: string;
  description?: string;
  category?: string;
  color: string;
  logo: string;
  launchBase: string;
}

interface Request {
  protocol: string;
  client_id: string;
  response_type: string;
  response_mode: string;
  nonce: string;
  state: string;
  dcql_query: object;
}

function parseRequest(): Request | { error: string } {
  const urlParams = new URLSearchParams(window.location.search);
  const protocol = urlParams.get('protocol') || 'smart-health-checkin-v1';

  if (protocol === 'smart-health-checkin-v1' || urlParams.get('response_type') === 'vp_token') {
    try {
      const clientIdRaw = urlParams.get('client_id');
      const responseType = urlParams.get('response_type');
      const responseMode = urlParams.get('response_mode');
      const nonce = urlParams.get('nonce');
      const state = urlParams.get('state');

      if (!clientIdRaw || !state || !nonce) {
        return { error: 'Missing required parameters (client_id, state, or nonce)' };
      }

      const req: Request = {
        protocol: 'smart-health-checkin-v1',
        client_id: clientIdRaw,
        response_type: responseType || 'vp_token',
        response_mode: responseMode || 'fragment',
        nonce,
        state,
        dcql_query: JSON.parse(urlParams.get('dcql_query') || '{}')
      };
      console.log('[Check-in] Request (OID4VP):', req);
      return req;
    } catch (e) {
      return { error: 'Invalid OID4VP request: ' + (e as Error).message };
    }
  }

  return { error: 'Missing request parameter. This page should be opened by the SMART Health Check-in library.' };
}

function AppCard({ app, req, disabled }: { app: AppConfig; req: Request; disabled: boolean }) {
  const handleClick = () => {
    if (disabled) return;

    console.log('[Check-in] Launching app:', app.id);

    const appParams = new URLSearchParams();
    appParams.set('client_id', req.client_id);
    appParams.set('response_type', 'vp_token');
    appParams.set('response_mode', 'fragment');
    appParams.set('state', req.state);
    appParams.set('nonce', req.nonce);
    appParams.set('dcql_query', JSON.stringify(req.dcql_query));

    const launchUrl = app.launchBase + '?' + appParams.toString();
    console.log('[Check-in] Launch URL (OID4VP):', launchUrl);

    const w = window.open(launchUrl, '_blank');
    if (!w) {
      console.warn('[Check-in] Popup blocked, navigating check-in window');
      location.href = launchUrl;
    } else {
      try { window.close(); } catch (e) { /* ignore */ }
    }
  };

  return (
    <div
      className={`card ${disabled ? 'disabled' : ''}`}
      style={{ '--brand-color': app.color } as React.CSSProperties}
      onClick={handleClick}
    >
      {app.logo && <div className="card-logo">{app.logo}</div>}
      <div className="card-name">{app.name || app.id}</div>
      <div className="card-desc">
        {disabled ? '(Example - Click Flexpa above)' : (app.description || 'Health data source')}
      </div>
    </div>
  );
}

export default function App() {
  const parsed = useMemo(() => parseRequest(), []);

  if ('error' in parsed) {
    return (
      <>
        <header>
          <div className="shield-icon">🛡️</div>
          <h1>Choose Your Health Data Source</h1>
          <div className="subtitle">Select where to retrieve your health information</div>
        </header>
        <main>
          <div className="error">{parsed.error}</div>
        </main>
        <Footer />
      </>
    );
  }

  const apps = config.checkin.apps;

  if (!apps || apps.length === 0) {
    return (
      <>
        <header>
          <div className="shield-icon">🛡️</div>
          <h1>Choose Your Health Data Source</h1>
          <div className="subtitle">Select where to retrieve your health information</div>
        </header>
        <main>
          <div className="error">No health data sources available.</div>
        </main>
        <Footer />
      </>
    );
  }

  // Group apps by category
  const categories: Record<string, { title: string; apps: AppConfig[] }> = {
    'ehr': { title: 'Health Systems', apps: [] },
    'phr': { title: 'Connected Apps', apps: [] },
    'healthplan': { title: 'Health Plans', apps: [] }
  };

  apps.forEach((app: AppConfig) => {
    const category = app.category || 'phr';
    if (categories[category]) {
      categories[category].apps.push(app);
    } else {
      categories.phr.apps.push(app);
    }
  });

  return (
    <>
      <header>
        <div className="shield-icon">🛡️</div>
        <h1>Choose Your Health Data Source</h1>
        <div className="subtitle">Select where to retrieve your health information</div>
      </header>
      <main>
        {Object.entries(categories).map(([key, category]) => {
          if (category.apps.length === 0) return null;
          return (
            <div key={key}>
              <div className="section-title">{category.title}</div>
              <div className="apps">
                {category.apps.map(app => (
                  <AppCard
                    key={app.id}
                    app={app}
                    req={parsed}
                    disabled={app.id !== 'flexpa'}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </main>
      <Footer />
    </>
  );
}

function Footer() {
  return (
    <footer>
      <div className="footer-title">Secure Routing by SMART Health Check-in</div>
      <div>We do not store your data</div>
    </footer>
  );
}
