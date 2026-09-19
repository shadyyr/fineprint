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
  return <AnalyzeView autoloadSample={"sample" in params} />;
}
