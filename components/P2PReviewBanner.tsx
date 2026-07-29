import { countUncategorizedP2P } from "@/lib/db/analytics";
import { P2PReviewBannerClient } from "./P2PReviewBannerClient";

/**
 * Server-rendered count of app payments awaiting a category. Renders nothing
 * when the queue is empty; otherwise a dismissible banner linking to /review.
 * Sits in the dashboard layout so it greets you on load from any page.
 */
export async function P2PReviewBanner() {
  const count = await countUncategorizedP2P();
  if (count === 0) return null;
  return <P2PReviewBannerClient count={count} />;
}
