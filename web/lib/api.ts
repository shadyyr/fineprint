/**
 * Server-side access to the Python extraction service.
 *
 * Route handlers proxy through here so the browser never talks to FastAPI
 * directly: it keeps the API key server-side once live extraction lands, and
 * avoids CORS entirely.
 */

export const API_BASE = process.env.FINEPRINT_API_URL ?? "http://127.0.0.1:8000";

/** How long to wait on the extraction service before giving up. */
const TIMEOUT_MS = 90_000;

export interface ApiFailure {
  status: number;
  detail: string;
}

/** Thrown when the service answers with an error we should show the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    /** Seconds, from the service's Retry-After on a 429. */
    readonly retryAfter: string | null = null,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

/**
 * POST a file to the extraction service.
 *
 * Network failure is surfaced as a 503 (a timeout as a 504) rather than thrown
 * raw, so the student sees a sentence instead of a fetch error.
 */
export async function postFile(
  path: string,
  file: File | Blob,
  filename: string,
  clientIp: string | null = null,
) {
  const body = new FormData();
  body.append("file", file, filename);

  // The service rate-limits per student. It only ever sees this server's
  // address, so pass the student's along -- with a shared secret, because the
  // service's URL is public and a bare forwarded-for header could be forged.
  const headers: Record<string, string> = {};
  const secret = process.env.FINEPRINT_PROXY_SECRET;
  if (secret && clientIp) {
    headers["X-FinePrint-Client-IP"] = clientIp;
    headers["X-FinePrint-Proxy-Secret"] = secret;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      body,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "TimeoutError") {
      throw new ApiError(
        504,
        `Reading the letter took longer than ${TIMEOUT_MS / 1000} seconds, so FinePrint stopped waiting. Try again, or explore the sample offer.`,
      );
    }
    // Shown to students, so no ports or service names. Developers: the
    // service is expected at FINEPRINT_API_URL (default http://127.0.0.1:8000).
    throw new ApiError(
      503,
      "FinePrint's letter reader isn't responding right now. Try again in a minute, or explore the sample offer.",
    );
  }

  if (!response.ok) {
    const detail = await readDetail(response);
    throw new ApiError(response.status, detail, response.headers.get("Retry-After"));
  }

  return response.json();
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // Fall through to the generic message below.
  }
  return `The extraction service returned ${response.status}.`;
}
