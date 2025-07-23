import {
  IPluginAuth,
  AuthCallback,
  AuthAccessCallback,
  PluginOptions,
  Logger,
  RemoteUser,
  PackageAccess
} from '@verdaccio/types';

import { getInternalError } from '@verdaccio/commons-api';
import fetch from 'node-fetch';

interface VerifiedUser {
  username: string;
  groups?: string[];
  email?: string;
}

export default class AuthCustomPlugin implements IPluginAuth<any> {
  public logger: Logger;
  private backendUrl: string;

  constructor(config: any, options: PluginOptions<any>) {
    this.logger = options.logger;
    this.backendUrl = config.backendUrl || 'https://api.test.vrse-builder.autovrse.app/api';
  }

  /**
   * Used for npm login (not needed if you rely only on token-based auth)
   */
  public authenticate(user: string, password: string, cb: AuthCallback): void {
    this.logger.info(`[auth-plugin] Ignoring username/password login`);
    cb(null, false);
  }

  /**
   * Custom JWT auth middleware - called on each request with Authorization header
   */
  public apiJWTmiddleware() {
    return async (req, res, next) => {
      const authHeader = req.headers['authorization'];

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        this.logger.warn('[auth-plugin] No Bearer token provided');
        return res.status(401).json({ error: 'Unauthorized: Token required' });
      }

      const token = authHeader.replace('Bearer ', '');

      try {
        const response = await fetch(`${this.backendUrl}/auth/login/token`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
          this.logger.warn(`[auth-plugin] Token invalid or expired (status: ${response.status})`);
          return res.status(403).json({ error: 'Forbidden: Invalid token' });
        }

        const result = await response.json();
        const user = result.details?.user;
        const username = user?.username;
        const role = user?.role;
        if (!username || !role) 
        {
          this.logger.warn('[auth-plugin] Invalid user object in response');
          return res.status(403).json({ error: 'Forbidden: Invalid user structure' });
        }
        req.remote_user = {
          name: username,
          groups: [role],
          real_groups: [role],
          email: user?.email ?? ''
        };

        this.logger.debug(`[auth-plugin] Token validated for user "${username}"`);
        next();
      } catch (error: any) {
        this.logger.error(`[auth-plugin] Auth server error: ${error.message}`);
        return res.status(500).json({ error: 'Internal error validating token' });
      }
    };
  }

  /**
   * Access control: determine whether user can access a package
   */
  public allow_access(user: RemoteUser, pkg: PackageAccess, cb: AuthAccessCallback): void {
    if (user.groups.includes('superAdmin') || user.groups.includes('productAdmin') || user.groups.includes('admin')) {
      this.logger.debug({ name: user.name }, `[auth-plugin] Access granted to @${user.name}`);
      cb(null, true);
    } else {
      this.logger.warn({ name: user.name }, `[auth-plugin] Access denied to @${user.name}`);
      cb(getInternalError('Access denied'), false);
    }
  }

  /**
   * Publish control - optional
   */
  public allow_publish(user: RemoteUser, pkg: PackageAccess, cb: AuthAccessCallback): void {
    if (user.groups.includes('superAdmin') || user.groups.includes('productAdmin')) {
      this.logger.debug({ name: user.name }, `[auth-plugin] Publish allowed for ${user.name}`);
      cb(null, true);
    } else {
      this.logger.warn({ name: user.name }, `[auth-plugin] Publish denied for ${user.name}`);
      cb(getInternalError('Not allowed to publish'), false);
    }
  }

  /**
   * Unpublish control - optional
   */
  public allow_unpublish(user: RemoteUser, pkg: PackageAccess, cb: AuthAccessCallback): void {
    if (user.groups.includes('superAdmin') || user.groups.includes('productAdmin')) {
      this.logger.debug({ name: user.name }, `[auth-plugin] Unpublish allowed for ${user.name}`);
      cb(null, true);
    } else {
      this.logger.warn({ name: user.name }, `[auth-plugin] Unpublish denied for ${user.name}`);
      cb(getInternalError('Not allowed to unpublish'), false);
    }
  }
}
