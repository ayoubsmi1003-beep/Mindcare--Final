"use client";
import { useEffect, useState } from "react";
import { setDbPort } from "@/services/db";
import { httpDbPort, qualificationAftercareRpc } from "@/services/db/http";
import { AftercareWorkspace } from "./AftercareWorkspace";
export function AftercareQualification({ patientId }: { patientId: string }): React.JSX.Element | null {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setDbPort({ ...httpDbPort, rpc: qualificationAftercareRpc }); setReady(true);
    return () => setDbPort(undefined);
  }, []);
  return ready ? <main className="p-8"><AftercareWorkspace key={patientId} patientId={patientId} /></main> : null;
}
