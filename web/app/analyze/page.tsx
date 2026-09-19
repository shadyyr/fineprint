import { AnalyzeView } from "./AnalyzeView";

/**
 * Reads `?sample` here, in a server component, rather than with
 * useSearchParams in the client. In Next 16 a client useSearchParams call
 * without a Suspense boundary works in development and then fails the
 * production build -- which would have broken the Vercel deploy only.
 */
export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // `?sample` is the first sample; `?sample=<slug>` picks one. Absent: no sample.
  const raw = params.sample;
  const sample = raw === undefined ? null : typeof raw === "string" ? raw : (raw[0] ?? "");
  return <AnalyzeView sample={sample} />;
}
