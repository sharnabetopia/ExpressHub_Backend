// Log only fixed categories and presence flags, never credentials or raw SDK errors.
export function rateLimitDiagnostics(error: unknown) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  let validUrl = false;
  try {
    const parsed = new URL(url ?? "");
    validUrl = parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch { /* Report invalid configuration below. */ }
  const message = error instanceof Error ? error.message : "";
  let reason = "BACKEND_ERROR";
  if (!url || !token) reason = "MISSING_CONFIGURATION";
  else if (!validUrl) reason = "INVALID_REST_URL";
  else if (url !== url.trim() || token !== token.trim() || /^["']|["']$/.test(token)) reason = "CREDENTIAL_FORMAT";
  else if (/WRONGPASS|unauthorized|invalid.*token|401/i.test(message)) reason = "AUTHENTICATION_FAILED";
  else if (/NOPERM|READONLY|read.only|forbidden|403/i.test(message)) reason = "PERMISSION_DENIED";
  else if (/timeout|timed out|abort/i.test(message)) reason = "BACKEND_TIMEOUT";
  else if (/fetch failed|ENOTFOUND|ECONN|network/i.test(message)) reason = "CONNECTION_FAILED";
  else if (/quota|limit exceeded|429/i.test(message)) reason = "BACKEND_QUOTA";
  return { reason, urlConfigured: Boolean(url), tokenConfigured: Boolean(token) };
}
