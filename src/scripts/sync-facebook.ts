// Import des publications Facebook : npm run sync-facebook (jeton dans FB_PAGE_TOKEN)
import { syncFromFacebook } from "../facebook/sync.js";

process.env.TZ ??= "Europe/Paris";
try {
  const count = await syncFromFacebook();
  console.log(`Facebook : ${count} publication(s) récupérée(s)`);
} catch (err) {
  console.error(`Facebook : échec de la synchronisation, actualités conservées. ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
