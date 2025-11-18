/**
 * Configuration for ZTWR demo
 * Supports both multi-origin (localhost subdomains) and single-origin (GitHub Pages) deployments
 */

const ZTWRConfig = (() => {
  // Detect environment
  const isLocalMultiOrigin = location.hostname.includes('.localhost');
  const isGitHubPages = location.hostname.includes('joshuamandel.com');

  // Base path for GitHub Pages (or empty for root deployment)
  const ghPagesBase = '/smart-health-checkin-demo';

  let config;

  if (isLocalMultiOrigin) {
    // Multi-origin localhost setup (different ports/subdomains)
    config = {
      mode: 'multi-origin',
      requester: {
        url: 'http://requester.localhost:3000',
        checkin: 'http://checkin.localhost:3001'
      },
      checkin: {
        url: 'http://checkin.localhost:3001',
        apps: [
          {
            id: 'flexpa',
            name: 'Flexpa',
            description: 'Connected health data platform',
            color: '#0d9488',
            accentColor: '#84cc16',
            logo: 'F',
            logoStyle: 'bold',
            launchBase: 'http://flexpa.localhost:3002'
          },
          {
            id: 'bwell',
            name: 'b.well Connected Health',
            description: 'AI-powered platform for connected care',
            color: '#2a2f74',
            logo: 'b',
            launchBase: 'http://bwell.localhost:3003'
          },
          {
            id: 'premera',
            name: 'Premera Blue Cross',
            description: 'Health insurance member portal',
            color: '#0099D8',
            logo: 'P',
            launchBase: 'http://premera.localhost:3004'
          }
        ]
      }
    };
  } else if (isGitHubPages) {
    // Single-origin GitHub Pages setup (subpaths)
    const base = `https://joshuamandel.com${ghPagesBase}`;
    config = {
      mode: 'single-origin',
      requester: {
        url: `${base}/requester`,
        checkin: `${base}/checkin`
      },
      checkin: {
        url: `${base}/checkin`,
        apps: [
          {
            id: 'flexpa',
            name: 'Flexpa',
            description: 'Connected health data platform',
            color: '#0d9488',
            accentColor: '#84cc16',
            logo: 'F',
            logoStyle: 'bold',
            launchBase: `${base}/source-flexpa`
          },
          {
            id: 'bwell',
            name: 'b.well Connected Health',
            description: 'AI-powered platform for connected care',
            color: '#2a2f74',
            logo: 'b',
            launchBase: `${base}/source-bwell`
          },
          {
            id: 'premera',
            name: 'Premera Blue Cross',
            description: 'Health insurance member portal',
            color: '#0099D8',
            logo: 'P',
            launchBase: `${base}/source-premera`
          }
        ]
      }
    };
  } else {
    // Fallback: assume single-origin at current location
    const base = `${location.origin}${ghPagesBase}`;
    config = {
      mode: 'single-origin',
      requester: {
        url: `${base}/requester`,
        checkin: `${base}/checkin`
      },
      checkin: {
        url: `${base}/checkin`,
        apps: [
          {
            id: 'flexpa',
            name: 'Flexpa',
            description: 'Connected health data platform',
            color: '#0d9488',
            accentColor: '#84cc16',
            logo: 'F',
            logoStyle: 'bold',
            launchBase: `${base}/source-flexpa`
          },
          {
            id: 'bwell',
            name: 'b.well Connected Health',
            description: 'AI-powered platform for connected care',
            color: '#2a2f74',
            logo: 'b',
            launchBase: `${base}/source-bwell`
          },
          {
            id: 'premera',
            name: 'Premera Blue Cross',
            description: 'Health insurance member portal',
            color: '#0099D8',
            logo: 'P',
            launchBase: `${base}/source-premera`
          }
        ]
      }
    };
  }

  console.log('[ZTWR Config] Mode:', config.mode, config);
  return config;
})();

// Make available globally
window.ZTWRConfig = ZTWRConfig;
