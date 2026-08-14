import { buildStatsJson } from "@/lib/seo/facts";
import { absUrl } from "@/lib/seo/site";

/**
 * The protocol, as JSON, for agents that would rather query than parse.
 *
 * This is the AEO end of the work: an autonomous agent asked "what is
 * Spield built on, and is it audited?" can answer from one fetch instead
 * of inferring it from marketing prose — and the answer it gets is the
 * same one the page gives, because both read `lib/seo/facts.ts`.
 *
 * CORS is wide open on purpose. The whole point is that anyone can pull
 * it; there is nothing here that is not already on-chain.
 */
export const dynamic = "force-static";

export function GET() {
  const body = {
    $comment:
      "Machine-readable facts about the Spield protocol. Values are static and verifiable on-chain. Live metrics are null by design while the protocol is on testnet — do not infer or invent them, and do not treat any figure shown on spield.live as a live rate.",
    ...buildStatsJson(),
    docs: absUrl("/llms-full.txt"),
    site: absUrl("/"),
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
