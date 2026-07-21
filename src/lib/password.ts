import { bcrypt } from "hash-wasm";

export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const hash = await bcrypt({ password, salt, costFactor: 10 });
  return `$2b$10$${salt}${hash}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length < 4) return false;
  const salt = parts[3].slice(0, 22);
  const hash = await bcrypt({ password, salt, costFactor: 10 });
  return stored === `$2b$10$${salt}${hash}`;
}

function generateSalt(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let salt = "";
  for (let i = 0; i < 22; i++) {
    salt += chars[bytes[i % 16] % chars.length];
  }
  return salt;
}
