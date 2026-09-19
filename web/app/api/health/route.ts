/**
 * Whether the extraction service is reachable and can read letters live.
 *
 * Used to decide whether to offer upload and live re-analysis at all, so a
 * deployment without the Python service says so up front instead of letting
 * someone upload a letter only to hit an error.
 */

import { connection } from "next/server";

import { API_BASE } from "@/lib/api";

export async function GET() {
  // This handler reads no request data, so without this Next could prerender
  // it at build time and bake "unreachable" into the deployment permanently.
  // (`export const dynamic` is no longer a route segment option in Next 16.)
  await connection();

  try {
    const response = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!response.ok) return Response.json({ reachable: false, live: false });
    const body = await response.json();
    return Response.json({ reachable: true, live: Boolean(body?.live_extraction) });
  } catch {
    return Response.json({ reachable: false, live: false });
  }
}
