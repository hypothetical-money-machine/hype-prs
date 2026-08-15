import { PrWorkspace } from "@/components/pr-workspace";
import { createDemoInbox } from "@/lib/demo-data";

export default function Home() {
  return <PrWorkspace initialDemoInbox={createDemoInbox()} />;
}
