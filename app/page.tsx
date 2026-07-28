import { PrWorkspace } from "@/components/pr-workspace";
import { demoInbox } from "@/lib/demo-data";

export default function Home() {
  return <PrWorkspace initialDemoInbox={demoInbox} />;
}
