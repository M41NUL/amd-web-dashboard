import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  try {
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    return {};
  }
}

function save(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

export function listUsers() {
  const users = load();
  return Object.values(users).sort((a, b) => a.name.localeCompare(b.name));
}

export function getUser(id) {
  const users = load();
  return users[id] || null;
}

export function findByPhone(phone) {
  const users = load();
  const p = normalizePhone(phone);
  return Object.values(users).find((u) => u.phone === p) || null;
}

export function addUser({ name, phone }) {
  const users = load();
  const cleanPhone = normalizePhone(phone);
  if (!name || !cleanPhone) {
    throw new Error('Name and phone are required');
  }
  const existing = Object.values(users).find((u) => u.phone === cleanPhone);
  if (existing) {
    throw new Error('A user with this phone number already exists');
  }
  const id = cleanPhone; // phone number doubles as the stable session id
  const user = {
    id,
    name,
    phone: cleanPhone,
    banned: false,
    createdAt: Date.now(),
    connected: false,
    account: null,
  };
  users[id] = user;
  save(users);
  return user;
}

export function removeUser(id) {
  const users = load();
  if (!users[id]) throw new Error('User not found');
  delete users[id];
  save(users);
}

export function setBanned(id, banned) {
  const users = load();
  if (!users[id]) throw new Error('User not found');
  users[id].banned = banned;
  save(users);
  return users[id];
}

export function updateUserState(id, patch) {
  const users = load();
  if (!users[id]) return null;
  users[id] = { ...users[id], ...patch };
  save(users);
  return users[id];
}

export function searchUsers(query) {
  const q = (query || '').trim().toLowerCase();
  const all = listUsers();
  if (!q) return all;
  return all.filter(
    (u) => u.name.toLowerCase().includes(q) || u.phone.includes(q)
  );
}
