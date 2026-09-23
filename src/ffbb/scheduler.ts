import { ffbbSync } from "../config.js";
import { readJson } from "../data/repository.js";
import { STATUS_FILE, syncFromFfbb, type SyncStatus } from "./sync.js";

const CHECK_EVERY_MS = 15 * 60 * 1000;
let running = false;

/** Lance la synchronisation FFBB au démarrage si les données sont anciennes, puis toutes les N heures */
export function startFfbbAutoSync(): void {
  if (!ffbbSync.enabled) {
    console.log("FFBB : synchronisation automatique désactivée (FFBB_SYNC=off)");
    return;
  }
  const intervalMs = ffbbSync.intervalHours * 60 * 60 * 1000;

  const tick = async () => {
    if (running) return;
    const status = await readJson<SyncStatus | null>(STATUS_FILE, null);
    const last = status?.lastAttempt ? new Date(status.lastAttempt).getTime() : 0;
    if (Date.now() - last < intervalMs) return;

    running = true;
    try {
      await syncFromFfbb();
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 5_000); // laisse le serveur démarrer avant la première synchro
  setInterval(tick, CHECK_EVERY_MS).unref();
  console.log(`FFBB : synchronisation automatique toutes les ${ffbbSync.intervalHours} h`);
}
