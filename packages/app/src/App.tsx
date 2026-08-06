import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import argoCdPlugin from '@roadiehq/backstage-plugin-argo-cd/alpha';
import { navModule } from './modules/nav';
import { authModule } from './apis';

export default createApp({
  features: [catalogPlugin, argoCdPlugin, navModule, authModule],
});
