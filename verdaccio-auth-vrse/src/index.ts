import {
  IPluginAuth,
  AuthCallback,
  AuthAccessCallback,
  PluginOptions,
  Logger,
  RemoteUser,
  PackageAccess,
  AllowAccess,
  AuthError,
} from '@verdaccio/types';
import { getForbidden, getInternalError } from '@verdaccio/commons-api';
import fetch from 'node-fetch';
import createError, { HttpError } from 'http-errors';
import { Request, Response, NextFunction } from 'express';

// Define a type for the request object extended with remote_user
type RequestWithUser = Request & { remote_user?: RemoteUser };

/**
 * Configuration interface for the plugin.
 */
interface AuthPluginConfig {
  backendUrl: string;
  // A URL to guide users to sign up, used in error messages.
  signupUrl?: string; 
}

/**
 * Implements a Verdaccio authentication plugin that validates bearer tokens
 * against an external backend service.
 */
export default class AuthCustomPlugin implements IPluginAuth<AuthPluginConfig> {
  public logger: Logger;
  private backendUrl: string;
  private signupUrl: string;
  // Helper function provided by Verdaccio to create a user object
  // Using definite assignment assertion (!) because it's initialized in apiJWTmiddleware, not the constructor.
  private createRemoteUser!: (name: string, groups: string[]) => RemoteUser;

  constructor(config: AuthPluginConfig, options: PluginOptions<AuthPluginConfig>) {
    this.logger = options.logger;
    this.backendUrl = config.backendUrl || 'https://api.test.vrse-builder.autovrse.app/api';
    this.signupUrl = config.signupUrl || 'your signup page';
    this.logger.info('[auth-plugin] Custom authentication plugin loaded');
  }

  /**
   * Disables standard npm login, as authentication is handled via tokens.
   * This method will be called when a user runs `npm login`.
   */
  public authenticate(user: string, password: string, cb: AuthCallback): void {
    this.logger.warn(`[auth-plugin] Denying npm login for user "${user}". Please use a bearer token.`);
    // Verdaccio's AuthCallback expects an error with a `code` property.
    // We create an error and manually assign the code to satisfy the type.
    const err = createError(405, `Login/Signup is not implemented. Please configure your token manually or visit ${this.signupUrl} to get a token.`) as AuthError;
    err.code = 405;
    cb(err, false);
  }

  /**
   * Disables standard npm user creation.
   */
  public adduser(user: string, password: string, cb: AuthCallback): void {
     this.logger.warn(`[auth-plugin] Denying npm adduser for user "${user}".`);
     const err = createError(405, `User creation is not implemented. Please visit ${this.signupUrl} to sign up.`) as AuthError;
     err.code = 405;
     cb(err, false);
  }

  /**
   * Provides the middleware to handle JWT-based authentication for API requests.
   * This is the core of the token-based authentication flow.
   * @param helpers - Verdaccio helpers, including `createRemoteUser`.
   * @returns An Express middleware function.
   */
  public apiJWTmiddleware(helpers: any) {
    // Store the helper function to create a valid RemoteUser object
    this.createRemoteUser = helpers.createRemoteUser;
    // Return the actual middleware function, bound to the class instance
    return this.handleJWT.bind(this);
  }

  /**
   * The actual middleware logic that validates the bearer token.
   */
  private async handleJWT(req: RequestWithUser, res: Response, _next: NextFunction): Promise<void> {
    // It's good practice to pause the request during async operations in middleware
    req.pause();

    // Create a wrapper for `next` to ensure the request is always resumed
    const next = (err?: HttpError) => {
      req.resume();
      _next(err);
    };

    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.warn('[auth-plugin] Request is missing a Bearer token.');
      // Pass a 401 Unauthorized error to the next middleware
      return next(createError(401, 'A Bearer token is required for authentication.'));
    }

    const token = authHeader.replace('Bearer ', '');

    try {
      // Call the external backend to validate the token
      const response = await fetch(`${this.backendUrl}/auth/login/token`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        this.logger.warn(`[auth-plugin] Token validation failed with status: ${response.status}`);
        // Pass a 403 Forbidden error if the token is invalid or expired
        return next(createError(response.status, 'The provided token is invalid or has expired.'));
      }

      const result = await response.json();
      const user = result.details?.user;
      const username = user?.username;
      const role = user?.role; // Assuming the role is the group

      if (!username || !role) {
        this.logger.error('[auth-plugin] The user object from the auth backend is missing `username` or `role`.');
        return next(createError(403, 'Received an invalid user profile from the authentication service.'));
      }

      // Use the Verdaccio helper to create the user object and attach it to the request.
      // This user object will be used in the allow_* methods.
      req.remote_user = this.createRemoteUser(username, [role]);

      this.logger.debug(`[auth-plugin] Token successfully validated for user "${username}" with role "${role}".`);
      // Proceed to the next middleware
      return next();
    } catch (error: any) {
      this.logger.error(`[auth-plugin] An unexpected error occurred while contacting the auth backend: ${error.message}`);
      // Pass a 500 Internal Server Error for unexpected issues
      return next(createError(500, 'An internal error occurred while validating the token.'));
    }
  }

  /**
   * A generic helper to check permissions against the package config.
   */
  private hasPermission(
  user: RemoteUser,
  pkg: AllowAccess & PackageAccess,
  permission: 'access' | 'publish' | 'unpublish',
  cb: AuthAccessCallback
  ): void {
    const requiredGroupsConfig = pkg[permission];
    let requiredGroups: string[] = [];

    // Check the type of the configuration value
    if (Array.isArray(requiredGroupsConfig)) {
      requiredGroups = requiredGroupsConfig;
    } 
    else {
      this.logger.warn(`[auth-plugin] Denied "${permission}" for user "${user.name}" for package "${pkg.name}" due to missing configuration in config.yaml.`);
      return cb(getForbidden(`Permissions for this package are not configured correctly in config.yaml.`), false);
    }

    // If requiredGroups is still empty, the config is missing or invalid
    if (requiredGroups.length === 0) {
      this.logger.warn(
        `[auth-plugin] Denied "${permission}" to user "${user.name}" for package "${pkg.name}" due to missing or invalid configuration.`
      );
      return cb(getForbidden(`Permissions for this package are not configured correctly.`), false);
    }

    if (user.groups.some(group => requiredGroups.includes(group))) {
      this.logger.debug(`[auth-plugin] Granted "${permission}" to user "${user.name}" for package "${pkg.name}".`);
      cb(null, true);
    } else {
      this.logger.warn(`[auth-plugin] Denied "${permission}" to user "${user.name}" for package "${pkg.name}".`);
      cb(getForbidden(`You do not have the required permissions to ${permission} this package.`), false);
    }
  }

  /**
   * Controls package access based on user roles (groups).
   * The method signature is updated to be compatible with the overloaded definition in the base interface.
   */
  public allow_access(user: RemoteUser, pkg: (AllowAccess & PackageAccess) | (AuthPluginConfig & PackageAccess), cb: AuthAccessCallback): void {
    // This plugin's logic is based on package access, so we must have a package name.
    if (!('name' in pkg) || !('access' in pkg)) {
        this.logger.warn(`[auth-plugin] Denying access for user "${user.name}" for a non-package-specific request.`);
        // Deny access if it's a general check not related to a specific package.
        return cb(getForbidden('This plugin only handles package-specific permissions.'), false);
    }

    this.hasPermission(user, pkg, 'access', cb);
  }

  /**
   * Controls package publishing based on user roles (groups).
   */
  public allow_publish(user: RemoteUser, pkg: (AllowAccess & PackageAccess) | (AuthPluginConfig & PackageAccess), cb: AuthAccessCallback): void {
    if (!('name' in pkg) || !('publish' in pkg)) {
        this.logger.warn(`[auth-plugin] Denying publish for user "${user.name}" for a non-package-specific request.`);
        return cb(getForbidden('This plugin only handles package-specific permissions.'), false);
    }
      
    this.hasPermission(user, pkg, 'publish', cb);
  }

  /**
   * Controls package unpublishing based on user roles (groups).
   */
  public allow_unpublish(user: RemoteUser, pkg: (AllowAccess & PackageAccess) | (AuthPluginConfig & PackageAccess), cb: AuthAccessCallback): void {
    if (!('name' in pkg) || !('unpublish' in pkg)) {
        this.logger.warn(`[auth-plugin] Denying unpublish for user "${user.name}" for a non-package-specific request.`);
        return cb(getForbidden('This plugin only handles package-specific permissions.'), false);
    }
      
    this.hasPermission(user, pkg, 'unpublish', cb);
  }
}
