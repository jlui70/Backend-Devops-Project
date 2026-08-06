/*
 * Hi!
 *
 * Note that this is an EXAMPLE Backstage backend. Please check the README.
 *
 * Happy hacking!
 */

import { createBackend } from '@backstage/backend-defaults';
import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from '@backstage/plugin-auth-node';
import { oidcAuthenticator } from '@backstage/plugin-auth-backend-module-oidc-provider';
import {
  stringifyEntityRef,
  DEFAULT_NAMESPACE,
} from '@backstage/catalog-model';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));

// scaffolder plugin
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-github'));
backend.add(
  import('@backstage/plugin-scaffolder-backend-module-notifications'),
);

// techdocs plugin
backend.add(import('@backstage/plugin-techdocs-backend'));

// auth plugin
backend.add(import('@backstage/plugin-auth-backend'));
// NOTE: we do NOT backend.add() the oidc-provider module itself — it would
// self-register a default 'oidc' provider and collide with the custom one
// registered below. Only its authenticator is imported and reused.
// See https://backstage.io/docs/backend-system/building-backends/migrating#the-auth-plugin
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
// See https://backstage.io/docs/auth/guest/provider

// Keycloak OIDC sign-in: the user must already exist in the catalog (synced by
// catalog-backend-module-keycloak below) so group ownership comes from real
// catalog relations instead of hand-rolled claims.
const keycloakAuthModule = createBackendModule({
  pluginId: 'auth',
  moduleId: 'keycloak-oidc-provider',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'oidc',
          factory: createOAuthProviderFactory({
            authenticator: oidcAuthenticator,
            async signInResolver(info, ctx) {
              const { preferred_username, sub } = info.result.fullProfile.userinfo;
              const name = preferred_username ?? sub;
              try {
                return await ctx.signInWithCatalogUser({
                  entityRef: { name },
                });
              } catch {
                // Fall back to an ephemeral identity if the Keycloak sync
                // hasn't picked up this user yet.
                const userRef = stringifyEntityRef({
                  kind: 'User',
                  name,
                  namespace: DEFAULT_NAMESPACE,
                });
                return ctx.issueToken({
                  claims: { sub: userRef, ent: [userRef] },
                });
              }
            },
          }),
        });
      },
    });
  },
});
backend.add(keycloakAuthModule);

// catalog plugin
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);

// GitHub catalog discovery
backend.add(import('@backstage/plugin-catalog-backend-module-github'));

// Keycloak user/group sync
backend.add(
  import('@backstage-community/plugin-catalog-backend-module-keycloak'),
);

// See https://backstage.io/docs/features/software-catalog/configuration#subscribing-to-catalog-errors
backend.add(import('@backstage/plugin-catalog-backend-module-logs'));

// permission plugin
backend.add(import('@backstage/plugin-permission-backend'));
// See https://backstage.io/docs/permissions/getting-started for how to create your own permission policy
backend.add(
  import('@backstage/plugin-permission-backend-module-allow-all-policy'),
);

// search plugin
backend.add(import('@backstage/plugin-search-backend'));

// search engine
// See https://backstage.io/docs/features/search/search-engines
backend.add(import('@backstage/plugin-search-backend-module-pg'));

// search collators
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@backstage/plugin-search-backend-module-techdocs'));

// kubernetes plugin
backend.add(import('@backstage/plugin-kubernetes-backend'));

// user settings plugin
backend.add(import('@backstage/plugin-user-settings-backend'));

// notifications and signals plugins
backend.add(import('@backstage/plugin-notifications-backend'));
backend.add(import('@backstage/plugin-signals-backend'));

// mcp actions plugin
backend.add(import('@backstage/plugin-mcp-actions-backend'));

// ArgoCD integration
backend.add(import('@roadiehq/backstage-plugin-argo-cd-backend'));

backend.start();
