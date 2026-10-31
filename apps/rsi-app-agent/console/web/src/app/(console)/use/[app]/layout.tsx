"use client";

import { useParams } from "next/navigation";
import { Failure, Loading } from "@/components/shell/page";
import { useApi } from "@/lib/api";
import { AppContext } from "@/lib/session";
import type { AppSummary } from "@/lib/session";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { app } = useParams<{ app: string }>();
  const { data, error, reload } = useApi<AppSummary>(`/api/apps/${app}`);
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  return <AppContext.Provider value={{ app: data, refresh: reload }}>{children}</AppContext.Provider>;
}
