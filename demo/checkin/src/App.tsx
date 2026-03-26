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

interface BootstrapRequest {
  protocol: string;
  client_id: string;
  request_uri: string;
  request_uri_method: string;
}

function parseRequest(): BootstrapRequest | { error: string } {
  const urlParams = new URLSearchParams(window.location.search);
  const clientId = urlParams.get('client_id');
  const requestUri = urlParams.get('request_uri');
  const requestUriMethod = urlParams.get('request_uri_method');

  if (clientId?.startsWith('well_known:')) {
    if (!requestUri || !requestUriMethod) {
      return { error: 'Missing request_uri or request_uri_method for well_known: flow' };
    }
    const req: BootstrapRequest = {
      protocol: 'smart-health-checkin-v1',
      client_id: clientId,
      request_uri: requestUri,
      request_uri_method: requestUriMethod,
    };
    console.log('[Check-in] Bootstrap request:', req);
    return req;
  }

  return { error: 'Missing or invalid client_id. Expected well_known: prefix.' };
}

function AppCard({ app, req, disabled }: { app: AppConfig; req: BootstrapRequest; disabled: boolean }) {
  const handleClick = () => {
    if (disabled) return;

    console.log('[Check-in] Launching app:', app.id);

    // Forward only bootstrap params
    const appParams = new URLSearchParams();
    appParams.set('client_id', req.client_id);
    appParams.set('request_uri', req.request_uri);
    appParams.set('request_uri_method', req.request_uri_method);

    const launchUrl = app.launchBase + '?' + appParams.toString();
    console.log('[Check-in] Launch URL:', launchUrl);

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
