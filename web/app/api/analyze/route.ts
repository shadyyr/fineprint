/**
 * Proxy an uploaded letter to the extraction service.
 *
 * Errors pass through with the service's own message. There is no fixture
 * fallback on this route: the fixture describes one specific made-up letter,
 * and substituting it for somebody's real upload would show them another
 * school's numbers as their own.
 */

import { ApiError, postFile } from "@/lib/api";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ detail: "No file was uploaded." }, { status: 400 });
  }

  try {
    return Response.json(await postFile("/analyze", file, file.name));
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json({ detail: error.detail }, { status: error.status });
    }
    throw error;
  }
}
