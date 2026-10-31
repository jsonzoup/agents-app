"use client";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApi } from "@/lib/api";
import type { Version } from "@/lib/kernel";

/** Versions of an app: releases, then candidates (open proposals, as they would be if released). */
export function useVersions(app: string) {
  return useApi<Version[]>(`/api/apps/${app}/versions`);
}

export function VersionPicker({
  app,
  value,
  onChange,
  className,
  candidates = true,
}: {
  app: string;
  value: string;
  onChange: (id: string) => void;
  className?: string;
  candidates?: boolean;
}) {
  const { data } = useVersions(app);
  const releases = (data ?? []).filter((v) => v.kind === "release");
  const proposals = candidates ? (data ?? []).filter((v) => v.kind === "candidate") : [];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "w-64"}>
        <SelectValue placeholder="选择版本" />
      </SelectTrigger>
      <SelectContent className="max-h-96">
        <SelectGroup>
          <SelectLabel>发布版本</SelectLabel>
          {releases.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              <span className="font-mono">{v.id}</span>
              {v.stable && <span className="ml-1 text-emerald-600">· 稳定版</span>}
              <span className="ml-2 max-w-48 truncate text-muted-foreground">{v.note}</span>
            </SelectItem>
          ))}
        </SelectGroup>
        {proposals.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>候选版本（未发布的提案）</SelectLabel>
              {proposals.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  <span className="font-mono">{v.id}</span>
                  <span className="ml-1 text-amber-600">· 候选</span>
                  <span className="ml-2 max-w-48 truncate text-muted-foreground">{v.note}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
