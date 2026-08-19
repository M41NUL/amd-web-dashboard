const logs = [];
const MAX_LOGS = 100;

export function addLog(entry) {
  logs.unshift({
    time: new Date().toLocaleTimeString(),
    ...entry,
  });
  if (logs.length > MAX_LOGS) {
    logs.pop();
  }
}

export function getLogs() {
  return logs;
}

export function clearLogs() {
  logs.length = 0;
}
