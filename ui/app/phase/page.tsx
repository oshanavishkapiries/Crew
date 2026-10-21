import { Suspense } from "react";
import { PhaseScreen } from "@/components/gates/phase-screen";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading phase…</p>}>
      <PhaseScreen />
    </Suspense>
  );
}
