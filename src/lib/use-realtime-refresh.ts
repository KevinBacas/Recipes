"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { startRealtimeRefresh, type RealtimeStatus } from "./realtime-controller";

export function useRealtimeRefresh(ownerId: string, tables: string[]) {
  const router = useRouter();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const tableKey = tables.join(",");
  const reconnect = useCallback(() => {
    setStatus("connecting");
    setConnectionAttempt((attempt) => attempt + 1);
    router.refresh();
  }, [router]);
  useEffect(() => {
    const subscription = startRealtimeRefresh({
      client: createClient(),
      ownerId,
      tables: tableKey.split(","),
      refreshPage: () => router.refresh(),
      onStatus: setStatus,
      reconnect,
      windowEvents: window,
      documentEvents: document,
    });
    return subscription.dispose;
  }, [ownerId, tableKey, router, connectionAttempt, reconnect]);
  return { status, reconnect };
}
