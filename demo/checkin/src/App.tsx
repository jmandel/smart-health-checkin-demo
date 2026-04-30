import React, { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
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
  launchKind?: 'web' | 'android-app-link' | 'custom-scheme';
  platform?: 'android' | 'any';
  installUrl?: string;
  fallbackUrl?: string;
}

interface BootstrapRequest {
  protocol: string;
  client_id: string;
  request_uri: string;
  request_uri_method?: string;
  launchMode?: 'replace';
  handoffId?: string;
}

function buildLaunchUrl(app: AppConfig, req: BootstrapRequest): string {
  const appParams = new URLSearchParams();
  appParams.set('client_id', req.client_id);
  appParams.set('request_uri', req.request_uri);
  if (req.request_uri_method) appParams.set('request_uri_method', req.request_uri_method);

  const separator = app.launchBase.includes('?') ? '&' : '?';
  return `${app.launchBase}${separator}${appParams.toString()}`;
}

function isNativeLaunch(app: AppConfig): boolean {
  return app.launchKind === 'android-app-link' || app.launchKind === 'custom-scheme';
}

function isAndroidDevice(): boolean {
  return /\bAndroid\b/i.test(navigator.userAgent);
}

function shouldShowApp(app: AppConfig, androidDevice: boolean): boolean {
  return app.platform !== 'android' || androidDevice;
}

function parseRequest(): BootstrapRequest | { error: string } {
  const urlParams = new URLSearchParams(window.location.search);
  const clientId = urlParams.get('client_id');
  const requestUri = urlParams.get('request_uri');
  const requestUriMethod = urlParams.get('request_uri_method');
  const launchMode = urlParams.get('shc_launch') === 'replace' ? 'replace' : undefined;
  const handoffId = urlParams.get('shc_handoff') || undefined;

  if (clientId?.startsWith('well_known:')) {
    if (!requestUri) {
      return { error: 'Missing request_uri for well_known: flow' };
    }
    const req: BootstrapRequest = {
      protocol: 'smart-health-checkin-v1',
      client_id: clientId,
      request_uri: requestUri,
      request_uri_method: requestUriMethod || undefined,
      launchMode,
      handoffId,
    };
    console.log('[Check-in] Bootstrap request:', req);
    return req;
  }

  return { error: 'Missing or invalid client_id. Expected well_known: prefix.' };
}

function NativeLaunchScreen({ appName, launchUrl, installUrl, webFallbackUrl }: {
  appName: string;
  launchUrl: string;
  installUrl?: string;
  webFallbackUrl?: string;
}) {
  return (
    <>
      <header>
        <div className="shield-icon">🛡️</div>
        <h1>Opening {appName}</h1>
        <div className="subtitle">You can close this picker tab after the app opens.</div>
      </header>
      <main>
        <div className="empty-state">
          <p>If the app did not open, use the button below.</p>
          <div className="card-actions centered-actions" style={{ '--brand-color': '#2563eb' } as React.CSSProperties}>
            <button type="button" className="card-action primary" onClick={() => { location.replace(launchUrl); }}>
              Open app
            </button>
            {webFallbackUrl && <a className="card-action" href={webFallbackUrl}>Use web app</a>}
            {installUrl && <a className="card-action" href={installUrl} target="_blank" rel="noreferrer">Install APK</a>}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function HandoffInactiveScreen() {
  return (
    <>
      <header>
        <div className="shield-icon">🛡️</div>
        <h1>Check-in Continued</h1>
        <div className="subtitle">This picker tab is no longer active.</div>
      </header>
      <main>
        <div className="empty-state">
          <p>The requester has received the shared check-in data in another browser tab.</p>
        </div>
      </main>
      <Footer />
    </>
  );
}

function AppCard({
  app,
  req,
  disabled,
  onNativeLaunch,
}: {
  app: AppConfig;
  req: BootstrapRequest;
  disabled: boolean;
  onNativeLaunch: (app: AppConfig, launchUrl: string) => void;
}) {
  const handleClick = () => {
    if (disabled) return;

    console.log('[Check-in] Launching app:', app.id);
    const launchUrl = buildLaunchUrl(app, req);
    console.log('[Check-in] Launch URL:', launchUrl);

    if (isNativeLaunch(app)) {
      onNativeLaunch(app, launchUrl);
      return;
    }

    if (req.launchMode === 'replace') {
      location.replace(launchUrl);
      return;
    }

    const w = window.open(launchUrl, '_blank');
    if (!w) {
      console.warn('[Check-in] Popup blocked, navigating check-in window');
      location.href = launchUrl;
    } else {
      try { window.close(); } catch (e) { /* ignore */ }
    }
  };

  const nativeLaunch = isNativeLaunch(app);

  return (
    <div
      className={`card ${disabled ? 'disabled' : ''} ${nativeLaunch ? 'native-card' : ''}`}
      style={{ '--brand-color': app.color } as React.CSSProperties}
      onClick={handleClick}
    >
      {app.logo && <div className="card-logo">{app.logo}</div>}
      <div className="card-name">{app.name || app.id}</div>
      <div className="card-desc">
        {disabled ? '(Example - Click Sample Health App above)' : (app.description || 'Health data source')}
      </div>
      {nativeLaunch && !disabled && (
        <div className="card-actions" onClick={e => e.stopPropagation()}>
          <button type="button" className="card-action primary" onClick={handleClick}>Open app</button>
          {app.installUrl && (
            <a className="card-action" href={app.installUrl} target="_blank" rel="noreferrer">Install APK</a>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const parsed = useMemo(() => parseRequest(), []);
  const [nativeLaunch, setNativeLaunch] = useState<{
    appName: string;
    launchUrl: string;
    installUrl?: string;
    webFallbackUrl?: string;
  } | null>(null);
  const [handoffInactive, setHandoffInactive] = useState(false);

  useEffect(() => {
    if ('error' in parsed || !parsed.handoffId || typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel(`shc-handoff-${parsed.handoffId}`);
    bc.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'complete' || event.data?.type === 'inactive') {
        setHandoffInactive(true);
      }
    };
    return () => bc.close();
  }, [parsed]);

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

  const apps = config.checkin.apps || [];
  const androidDevice = isAndroidDevice();
  const visibleApps = apps.filter((app: AppConfig) => shouldShowApp(app, androidDevice));

  const launchNativeApp = (app: AppConfig, launchUrl: string) => {
    const webFallbackUrl = app.fallbackUrl ? buildLaunchUrl({ ...app, launchBase: app.fallbackUrl }, parsed) : undefined;
    flushSync(() => setNativeLaunch({
      appName: app.name || app.id,
      launchUrl,
      installUrl: app.installUrl,
      webFallbackUrl,
    }));

    setTimeout(() => {
      try { window.close(); } catch { /* ignore */ }
    }, 500);
    location.replace(launchUrl);
  };

  if (handoffInactive) {
    return <HandoffInactiveScreen />;
  }

  if (nativeLaunch) {
    return <NativeLaunchScreen {...nativeLaunch} />;
  }

  if (!visibleApps || visibleApps.length === 0) {
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

  visibleApps.forEach((app: AppConfig) => {
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
                    disabled={app.id !== 'sample-health' && app.id !== 'sample-health-android-demo'}
                    onNativeLaunch={launchNativeApp}
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
