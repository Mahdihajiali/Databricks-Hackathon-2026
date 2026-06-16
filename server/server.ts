import { createApp, analytics, files, genie, lakebase, server } from '@databricks/appkit';
import { setupReferralCopilotRoutes } from './routes/genie/referral-copilot-routes';
import { setupDataReadinessRoutes } from './routes/lakebase/data-readiness-routes';

createApp({
  plugins: [
    analytics(),
    files(),
    genie(),
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    setupReferralCopilotRoutes(appkit);
    await setupDataReadinessRoutes(appkit);
  },
}).catch(console.error);
