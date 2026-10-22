import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "./db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set");
  return "dev-only-session-secret";
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function signSession(uid: string, ttlSeconds = 60 * 60 * 24 * 30): string {
  const payload = `${uid}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  return `${payload}.${sign(payload)}`;
}

export function readSession(token: string | undefined): string | null {
  if (!token) return null;
  const [uid, exp, sig] = token.split(".");
  if (!uid || !exp || !sig) return null;
  const expected = sign(`${uid}.${exp}`);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return uid;
}

export type NewAccount = { email: string; password: string; displayName: string; community?: string | null };

export async function createAccount(input: NewAccount): Promise<string> {
  const hash = await hashPassword(input.password);
  return sql.begin(async (tx) => {
    const [account] = await tx<{ id: string }[]>`
      insert into accounts (email, password_hash) values (${input.email.trim().toLowerCase()}, ${hash}) returning id`;
    if (!account) throw new Error("account insert failed");
    await tx`insert into profiles (id, display_name, community)
             values (${account.id}, ${input.displayName.trim()}, ${input.community?.trim() || null})`;
    return account.id;
  }) as Promise<string>;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const [row] = await sql<{ id: string; password_hash: string }[]>`
    select id, password_hash from accounts where email = ${email.trim().toLowerCase()}`;
  if (!row) return null;
  return (await verifyPassword(password, row.password_hash)) ? row.id : null;
}
