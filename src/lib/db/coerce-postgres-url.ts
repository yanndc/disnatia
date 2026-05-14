/**
 * Reconstruit une URI Postgres valide lorsque le mot de passe contient @, :, %, etc.
 * `new URL()` échoue sur des chaînes non encodées ; le dernier `@` sépare userinfo et host.
 */
export function coerceValidPostgresUrl(input: string): string {
  let trimmed = input.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (!trimmed) return trimmed;

  try {
    const probe = new URL(trimmed);
    if (probe.protocol === "postgres:" || probe.protocol === "postgresql:") {
      return trimmed;
    }
  } catch {
    // continuer
  }

  const protoMatch = trimmed.match(/^((?:postgres|postgresql):\/\/)/i);
  if (!protoMatch) {
    return trimmed;
  }

  const protocol = protoMatch[1].toLowerCase();
  const rest = trimmed.slice(protocol.length);

  const qIndex = rest.indexOf("?");
  const main = qIndex >= 0 ? rest.slice(0, qIndex) : rest;
  const search = qIndex >= 0 ? rest.slice(qIndex) : "";

  const atIndex = main.lastIndexOf("@");
  if (atIndex === -1) {
    return trimmed;
  }

  const userinfo = main.slice(0, atIndex);
  const hostAndPath = main.slice(atIndex + 1);
  const firstSlash = hostAndPath.indexOf("/");
  const hostPort =
    firstSlash >= 0 ? hostAndPath.slice(0, firstSlash) : hostAndPath;
  const dbPath =
    firstSlash >= 0 ? hostAndPath.slice(firstSlash) : "";

  const colonIdx = userinfo.indexOf(":");
  const user =
    colonIdx >= 0 ? userinfo.slice(0, colonIdx) : userinfo;
  const password =
    colonIdx >= 0 ? userinfo.slice(colonIdx + 1) : "";

  const userEnc = encodeURIComponent(safeDecode(user));
  const passEnc = encodeURIComponent(safeDecode(password));

  const rebuilt = `${protocol}${userEnc}:${passEnc}@${hostPort}${dbPath}${search}`;

  try {
    const u = new URL(rebuilt);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") {
      return trimmed;
    }
    return rebuilt;
  } catch {
    return trimmed;
  }
}

function safeDecode(s: string): string {
  if (!s) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
