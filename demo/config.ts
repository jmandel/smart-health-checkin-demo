/**
 * Configuration for SMART Health Check-in demo
 * Supports both multi-origin (localhost subdomains) and single-origin (GitHub Pages) deployments
 */

export interface AppConfig {
  id: string;
  name: string;
  description: string;
  category?: string;
  color: string;
  accentColor?: string;
  logo: string;
  logoStyle?: string;
  launchBase: string;
}

export interface Config {
  mode: 'multi-origin' | 'single-origin';
  requester: {
    url: string;
    checkin: string;
  };
  checkin: {
    url: string;
    apps: AppConfig[];
  };
}

function createConfig(): Config {
  const isLocalMultiOrigin = location.hostname.includes('.localhost');
  const isGitHubPages = location.hostname.includes('joshuamandel.com');
  const ghPagesBase = '/smart-health-checkin-demo';

  if (isLocalMultiOrigin) {
    return {
      mode: 'multi-origin',
      requester: {
        url: 'http://requester.localhost:3000',
        checkin: 'http://checkin.localhost:3001'
      },
      checkin: {
        url: 'http://checkin.localhost:3001',
        apps: [
          {
            id: 'premera',
            name: 'Premera Blue Cross',
            description: 'Health insurance member portal',
            category: 'healthplan',
            color: '#0099D8',
            logo: 'P',
            launchBase: 'http://premera.localhost:3004'
          },
          {
            id: 'flexpa',
            name: 'Flexpa',
            description: 'Connected health data platform',
            category: 'phr',
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
            category: 'phr',
            color: '#2a2f74',
            logo: 'b',
            launchBase: 'http://bwell.localhost:3003'
          }
        ]
      }
    };
  }

  // Single-origin setup (GitHub Pages or fallback)
  const base = isGitHubPages
    ? `https://joshuamandel.com${ghPagesBase}`
    : `${location.origin}${ghPagesBase}`;

  return {
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

export const config = createConfig();
console.log('[Config] Mode:', config.mode, config);
