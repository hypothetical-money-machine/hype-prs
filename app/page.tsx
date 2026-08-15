import { PrWorkspace } from "@/components/pr-workspace";
import { createDemoInbox } from "@/lib/demo-data";

// The root layout reads request headers in generateMetadata to resolve the
// site origin, so this route can never be prerendered. Declaring it keeps the
// build report from guessing.
export const dynamic = "force-dynamic";

export default function Home() {
  return <PrWorkspace initialDemoInbox={createDemoInbox()} />;
}
