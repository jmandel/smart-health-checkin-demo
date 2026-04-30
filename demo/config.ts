/**
 * Build-time configuration for SMART Health Check-in demo apps.
 *
 * `build.ts` bakes one JSON deployment profile into this constant using
 * Bun's `define` option. See `deployments/local.json` and
 * `deployments/public-demo.json`.
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
  launchKind?: 'web' | 'android-app-link' | 'custom-scheme';
  platform?: 'android' | 'any';
  installUrl?: string;
  fallbackUrl?: string;
}

export interface Config {
  mode: 'multi-origin' | 'single-origin';
  portal: {
    url: string;
    walletUrl: string;
  };
  kiosk: {
    url: string;
    walletUrl: string;
  };
  wellKnownClientUrl: string;
  checkin: {
    url: string;
    apps: AppConfig[];
  };
}

declare const __SMART_HEALTH_CHECKIN_DEMO_CONFIG__: Config;

export const config = __SMART_HEALTH_CHECKIN_DEMO_CONFIG__;
console.log('[Config]', config);
