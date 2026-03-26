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

function createConfig(): Config {
  const isLocalMultiOrigin = location.hostname.includes('.localhost');

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
            id: 'flexpa', name: 'Flexpa',
            description: 'Connected health data platform', category: 'phr',
            color: '#0d9488', accentColor: '#84cc16', logo: 'F', logoStyle: 'bold',
            launchBase: 'http://flexpa.localhost:3002'
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
          id: 'flexpa', name: 'Flexpa',
          description: 'Connected health data platform',
          color: '#0d9488', accentColor: '#84cc16', logo: 'F', logoStyle: 'bold',
          launchBase: `${location.origin}/source-flexpa`
        },
        {
          id: 'bwell', name: 'b.well Connected Health',
          description: 'AI-powered platform for connected care',
          color: '#2a2f74', logo: 'b',
          launchBase: `${location.origin}/source-bwell`
        },
        {
          id: 'premera', name: 'Premera Blue Cross',
          description: 'Health insurance member portal',
          color: '#0099D8', logo: 'P',
          launchBase: `${location.origin}/source-premera`
        }
      ]
    }
  };
}

export const config = createConfig();
console.log('[Config] Mode:', config.mode, config);
