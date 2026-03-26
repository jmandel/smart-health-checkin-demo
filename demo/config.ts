/**
 * Configuration for SMART Health Check-in demo
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
  portal: {
    url: string;
    checkin: string;
  };
  kiosk: {
    url: string;
    checkin: string;
  };
  verifier: {
    base: string;
  };
  checkin: {
    url: string;
    apps: AppConfig[];
  };
}

const DEMO_SERVER = 'https://smart-health-checkin.exe.xyz';

function createConfig(): Config {
  const isLocalMultiOrigin = location.hostname.includes('.localhost');
  const isGitHubPages = location.hostname.includes('joshuamandel.com');

  if (isLocalMultiOrigin) {
    return {
      mode: 'multi-origin',
      portal: {
        url: 'http://requester.localhost:3000',
        checkin: 'http://checkin.localhost:3001'
      },
      kiosk: {
        url: 'http://requester.localhost:3000/kiosk/',
        checkin: 'http://checkin.localhost:3001'
      },
      verifier: {
        base: 'http://requester.localhost:3000'
      },
      checkin: {
        url: 'http://checkin.localhost:3001',
        apps: [
          {
            id: 'premera', name: 'Premera Blue Cross',
            description: 'Health insurance member portal', category: 'healthplan',
            color: '#0099D8', logo: 'P',
            launchBase: 'http://premera.localhost:3004'
          },
          {
            id: 'sample-health', name: 'Sample Health App',
            description: 'Connected health data platform', category: 'phr',
            color: '#0d9488', accentColor: '#84cc16', logo: 'S', logoStyle: 'bold',
            launchBase: 'http://sample-health.localhost:3002'
          },
          {
            id: 'bwell', name: 'b.well Connected Health',
            description: 'AI-powered platform for connected care', category: 'phr',
            color: '#2a2f74', logo: 'b',
            launchBase: 'http://bwell.localhost:3003'
          }
        ]
      }
    };
  }

  if (isGitHubPages) {
    // GH Pages: static frontend, verifier/relay at DEMO_SERVER
    const ghBase = `${location.origin}/smart-health-checkin-demo`;
    return {
      mode: 'single-origin',
      portal: {
        url: `${ghBase}/portal`,
        checkin: `${ghBase}/checkin`
      },
      kiosk: {
        url: `${ghBase}/kiosk`,
        checkin: `${ghBase}/checkin`
      },
      verifier: {
        base: DEMO_SERVER
      },
      checkin: {
        url: `${ghBase}/checkin`,
        apps: [
          {
            id: 'sample-health', name: 'Sample Health App',
            description: 'Connected health data platform',
            color: '#0d9488', accentColor: '#84cc16', logo: 'S', logoStyle: 'bold',
            launchBase: `${ghBase}/source-app`
          },
          {
            id: 'bwell', name: 'b.well Connected Health',
            description: 'AI-powered platform for connected care',
            color: '#2a2f74', logo: 'b',
            launchBase: `${ghBase}/source-bwell`
          }
        ]
      }
    };
  }

  // Single-origin: everything on same server
  return {
    mode: 'single-origin',
    portal: {
      url: `${location.origin}/portal`,
      checkin: `${location.origin}/checkin`
    },
    kiosk: {
      url: `${location.origin}/kiosk`,
      checkin: `${location.origin}/checkin`
    },
    verifier: {
      base: location.origin
    },
    checkin: {
      url: `${location.origin}/checkin`,
      apps: [
        {
          id: 'sample-health', name: 'Sample Health App',
          description: 'Connected health data platform',
          color: '#0d9488', accentColor: '#84cc16', logo: 'S', logoStyle: 'bold',
          launchBase: `${location.origin}/source-app`
        },
        {
          id: 'bwell', name: 'b.well Connected Health',
          description: 'AI-powered platform for connected care',
          color: '#2a2f74', logo: 'b',
          launchBase: `${location.origin}/source-bwell`
        }
      ]
    }
  };
}

export const config = createConfig();
console.log('[Config] Mode:', config.mode, config);
