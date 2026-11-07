// Import des publications et des événements Facebook : npm run sync-facebook (jeton dans FB_PAGE_TOKEN).
// npm run sync-facebook -- --evenements fichier.json : événements lus dans une réponse de l'API enregistrée.
import { readFile } from "node:fs/promises";
import { saveEvents, syncEventsFromFacebook, type FbEvent } from "../facebook/events.js";
import { syncFromFacebook } from "../facebook/sync.js";

process.env.TZ ??= "Europe/Paris";
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
let failed = false;

const file = process.argv[process.argv.indexOf("--evenements") + 1];
if (process.argv.includes("--evenements") && file) {
  const { data } = JSON.parse(await readFile(file, "utf8")) as { data: FbEvent[] };
  console.log(`Facebook : ${await saveEvents(data)} événement(s) enregistré(s)`);
  process.exit(0);
}

try {
  console.log(`Facebook : ${await syncFromFacebook()} publication(s) récupérée(s)`);
} catch (err) {
  console.error(`Facebook : échec de la synchronisation, actualités conservées. ${message(err)}`);
  failed = true;
}
try {
  console.log(`Facebook : ${await syncEventsFromFacebook()} événement(s) récupéré(s)`);
} catch (err) {
  console.error(`Facebook : échec de l'import des événements, événements conservés. ${message(err)}`);
  failed = true;
}
if (failed) process.exit(1);
