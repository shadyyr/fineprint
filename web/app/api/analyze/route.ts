/**
 * Proxy an uploaded letter to the extraction service.
 *
 * Errors pass through with the service's own message. There is no fixture
 * fallback on this route: the fixture describes one specific made-up letter,
 * and substituting it for somebody's real upload would show them another
 * school's numbers as their own.
 */

import { ApiError, postFile } from "@/lib/api";

// A live read can take most of a minute (and the client waits up to 90 s), so
// give the function room beyond Vercel's default.
export const maxDuration = 120;

/** The student's address as Vercel reports it; the leftmost forwarded hop. */
function clientIp(request: Request): string | null {
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() || null : null;
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ detail: "No file was uploaded." }, { status: 400 });
  }

  try {
    return Response.json(await postFile("/analyze", file, file.name, clientIp(request)));
  } catch (error) {
    if (error instanceof ApiError) {
      const headers = error.retryAfter ? { "Retry-After": error.retryAfter } : undefined;
      return Response.json({ detail: error.detail }, { status: error.status, headers });
    }
    throw error;
  }
}
