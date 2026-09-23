// Synchronisation manuelle : npm run sync-ffbb
import { syncFromFfbb } from "../ffbb/sync.js";

process.env.TZ ??= "Europe/Paris";
const status = await syncFromFfbb();
process.exit(status.error ? 1 : 0);
