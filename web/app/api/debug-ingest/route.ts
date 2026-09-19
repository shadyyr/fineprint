/**
 * Proxy for the coordinate validator.
 *
 * Returns every extracted layout line so /debug/boxes can draw each box over
 * the rendered page. Development tooling, but the single most important check
 * in the project: if these boxes do not sit on their text, every evidence
 * highlight downstream is wrong.
 */

import { ApiError, postFile } from "@/lib/api";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ detail: "No file was uploaded." }, { status: 400 });
  }

  try {
    return Response.json(await postFile("/debug/ingest", file, file.name));
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json({ detail: error.detail }, { status: error.status });
    }
    throw error;
  }
}
