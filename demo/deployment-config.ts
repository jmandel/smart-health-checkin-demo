import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

export interface DeploymentConfig {
  name: string;
  serve?: {
    port?: number;
    verifierOrigin?: string;
    canonicalOrigin?: string;
    allowedSameDeviceOrigins?: string[];
  };
  clientConfig: unknown;
  extraApps?: unknown[];
}

export interface LoadDeploymentConfigOptions {
  builtConfigPath?: string;
}

export function loadDeploymentConfig(root: string, options: LoadDeploymentConfigOptions = {}): DeploymentConfig {
  const selector = process.env.DEMO_CONFIG
    || process.env.DEPLOYMENT_CONFIG
    || process.env.DEPLOYMENT
    || 'local';
  const hasExplicitSelector = Boolean(process.env.DEMO_CONFIG || process.env.DEPLOYMENT_CONFIG || process.env.DEPLOYMENT);
  const configPath = !hasExplicitSelector && options.builtConfigPath && existsSync(options.builtConfigPath)
    ? options.builtConfigPath
    : resolveConfigPath(root, selector);

  if (!existsSync(configPath)) {
    throw new Error(`Deployment config not found: ${configPath}`);
  }

  const raw = readFileSync(configPath, 'utf8');
  const expanded = expandEnv(raw);
  const config = JSON.parse(expanded) as DeploymentConfig;
  if (!config.clientConfig) {
    throw new Error(`Deployment config missing clientConfig: ${configPath}`);
  }
  appendExtraApps(config, configPath);
  return config;
}

function appendExtraApps(config: DeploymentConfig, configPath: string): void {
  if (!config.extraApps) return;
  if (!Array.isArray(config.extraApps)) {
    throw new Error(`Deployment config extraApps must be an array: ${configPath}`);
  }
  if (config.extraApps.length === 0) return;

  const clientConfig = config.clientConfig as { checkin?: { apps?: unknown[] } };
  const apps = clientConfig.checkin?.apps;
  if (!Array.isArray(apps)) {
    throw new Error(`Deployment config extraApps requires clientConfig.checkin.apps: ${configPath}`);
  }

  const existingIds = new Set(apps.map((app) => appId(app)).filter(Boolean));
  const newApps = config.extraApps.filter((app) => {
    const id = appId(app);
    return !id || !existingIds.has(id);
  });

  clientConfig.checkin!.apps = [...apps, ...newApps];
}

function appId(app: unknown): string | undefined {
  if (!app || typeof app !== 'object') return undefined;
  const id = (app as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function resolveConfigPath(root: string, selector: string): string {
  const isPath = selector.startsWith('.') || selector.startsWith('/') || selector.includes('/');
  const fileName = selector.endsWith('.json') ? selector : `${selector}.json`;
  return isPath ? resolve(root, selector) : join(root, 'deployments', fileName);
}

function expandEnv(input: string): string {
  return input.replace(/\$\{([A-Z0-9_]+)(:-([^}]*))?\}/g, (_match, name: string, _fallbackExpression: string, fallback: string) => {
    const value = process.env[name];
    return value ? value : fallback ?? '';
  });
}
