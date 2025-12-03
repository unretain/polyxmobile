// User database simulation using localStorage
// In production, this would be replaced with a real database

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  name?: string;
  emailVerified: boolean;
  verificationCode?: string;
  verificationExpiry?: number;
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  wallet?: {
    publicKey: string;
    encryptedSecretKey: string;
  };
  createdAt: number;
  updatedAt: number;
}

const USERS_KEY = "polyx-users";

function getUsers(): Record<string, StoredUser> {
  if (typeof window === "undefined") return {};
  const data = localStorage.getItem(USERS_KEY);
  return data ? JSON.parse(data) : {};
}

function saveUsers(users: Record<string, StoredUser>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

// Simple hash function for passwords (in production, use bcrypt on server)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "polyx-salt-2024");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  const inputHash = await hashPassword(password);
  return inputHash === hash;
}

export function getUserByEmail(email: string): StoredUser | null {
  const users = getUsers();
  const normalizedEmail = email.toLowerCase();
  return Object.values(users).find((u) => u.email === normalizedEmail) || null;
}

export function getUserById(id: string): StoredUser | null {
  const users = getUsers();
  return users[id] || null;
}

export async function createUser(
  email: string,
  password: string,
  skipEmailVerification: boolean = false
): Promise<{ user: StoredUser; verificationCode: string }> {
  const users = getUsers();
  const normalizedEmail = email.toLowerCase();

  // Check if user exists
  const existing = getUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error("User already exists");
  }

  // Generate 6-digit verification code
  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

  const user: StoredUser = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    passwordHash: await hashPassword(password),
    name: normalizedEmail.split("@")[0],
    emailVerified: skipEmailVerification, // For Phantom users, skip email verification
    verificationCode: skipEmailVerification ? undefined : verificationCode,
    verificationExpiry: skipEmailVerification ? undefined : Date.now() + 10 * 60 * 1000, // 10 minutes
    twoFactorEnabled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  users[user.id] = user;
  saveUsers(users);

  return { user, verificationCode };
}

export function verifyEmail(userId: string, code: string): boolean {
  const users = getUsers();
  const user = users[userId];

  if (!user) return false;
  if (user.verificationCode !== code) return false;
  if (user.verificationExpiry && Date.now() > user.verificationExpiry)
    return false;

  user.emailVerified = true;
  user.verificationCode = undefined;
  user.verificationExpiry = undefined;
  user.updatedAt = Date.now();

  saveUsers(users);
  return true;
}

export function resendVerificationCode(userId: string): string | null {
  const users = getUsers();
  const user = users[userId];

  if (!user) return null;

  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
  user.verificationCode = verificationCode;
  user.verificationExpiry = Date.now() + 10 * 60 * 1000;
  user.updatedAt = Date.now();

  saveUsers(users);
  return verificationCode;
}

export function enableTwoFactor(userId: string, secret: string): boolean {
  const users = getUsers();
  const user = users[userId];

  if (!user) return false;

  user.twoFactorEnabled = true;
  user.twoFactorSecret = secret;
  user.updatedAt = Date.now();

  saveUsers(users);
  return true;
}

export function disableTwoFactor(userId: string): boolean {
  const users = getUsers();
  const user = users[userId];

  if (!user) return false;

  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  user.updatedAt = Date.now();

  saveUsers(users);
  return true;
}

export function setUserWallet(
  userId: string,
  publicKey: string,
  encryptedSecretKey: string
): boolean {
  const users = getUsers();
  const user = users[userId];

  if (!user) return false;

  user.wallet = { publicKey, encryptedSecretKey };
  user.updatedAt = Date.now();

  saveUsers(users);
  return true;
}

export function updateUserName(userId: string, name: string): boolean {
  const users = getUsers();
  const user = users[userId];

  if (!user) return false;

  user.name = name;
  user.updatedAt = Date.now();

  saveUsers(users);
  return true;
}

// Simple encryption for wallet secret key (in production, use proper encryption)
export function encryptSecretKey(secretKey: string, password: string): string {
  // XOR-based simple encryption (for demo - use AES in production)
  const combined = secretKey + password;
  return btoa(combined);
}

export function decryptSecretKey(encrypted: string, password: string): string {
  const decrypted = atob(encrypted);
  return decrypted.replace(password, "");
}

// Password reset functions
export function generatePasswordResetCode(email: string): string | null {
  const users = getUsers();
  const normalizedEmail = email.toLowerCase();
  const user = Object.values(users).find((u) => u.email === normalizedEmail);

  if (!user) return null;

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  user.verificationCode = resetCode;
  user.verificationExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  user.updatedAt = Date.now();

  saveUsers(users);
  return resetCode;
}

export function verifyResetCode(email: string, code: string): boolean {
  const user = getUserByEmail(email);
  if (!user) return false;
  if (user.verificationCode !== code) return false;
  if (user.verificationExpiry && Date.now() > user.verificationExpiry) return false;
  return true;
}

export async function resetPassword(email: string, code: string, newPassword: string): Promise<boolean> {
  const users = getUsers();
  const normalizedEmail = email.toLowerCase();
  const user = Object.values(users).find((u) => u.email === normalizedEmail);

  if (!user) return false;
  if (user.verificationCode !== code) return false;
  if (user.verificationExpiry && Date.now() > user.verificationExpiry) return false;

  // Hash the new password
  const encoder = new TextEncoder();
  const data = encoder.encode(newPassword + "polyx-salt-2024");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const newPasswordHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  user.passwordHash = newPasswordHash;
  user.verificationCode = undefined;
  user.verificationExpiry = undefined;
  user.updatedAt = Date.now();

  saveUsers(users);
  return true;
}
