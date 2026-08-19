const logs = [];
const MAX_LOGS = 200;
const SERVER_START_TIME = Date.now();

export function addLog(entry) {
  logs.unshift({
    time: new Date().toLocaleTimeString(),
    timestamp: Date.now(),
    ...entry,
  });
  if (logs.length > MAX_LOGS) {
    logs.pop();
  }
}

export function getLogs() {
  return logs;
}

export function getLogsForUser(ownerUserId) {
  return logs.filter((l) => l.ownerUserId === ownerUserId);
}

export function clearLogs() {
  logs.length = 0;
}

export function getServerUptimeSeconds() {
  return Math.floor((Date.now() - SERVER_START_TIME) / 1000);
}
