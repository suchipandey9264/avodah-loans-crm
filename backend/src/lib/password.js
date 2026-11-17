import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Passwords are hashed with Node's built-in scrypt (memory-hard; no native add-on needed).
// Stored as "scrypt$N$r$p$salt$hash" so the cost can be raised later without breaking old hashes.
const scryptAsync = promisify(scrypt);
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 128 * N * R * 2; // scrypt needs ~128·N·r bytes; Node's default cap (32 MB) is too small for N = 2^15

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const [algo, n, r, p, salt, hash] = String(stored ?? "").split("$");
  if (algo !== "scrypt" || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return timingSafeEqual(actual, expected);
}

// Compared against when the email is unknown, so a failed login takes the same time either way.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));
