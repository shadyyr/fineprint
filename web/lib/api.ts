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
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

/**
 * POST a file to the extraction service.
 *
 * Network failure is surfaced as a 503 rather than thrown raw, so the caller
 * can fall back to the committed fixture and label it honestly.
 */
export async function postFile(path: string, file: File | Blob, filename: string) {
  const body = new FormData();
  body.append("file", file, filename);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(
      503,
      "FinePrint could not reach the extraction service. Is it running on port 8000?",
    );
  }

  if (!response.ok) {
    const detail = await readDetail(response);
    throw new ApiError(response.status, detail);
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
