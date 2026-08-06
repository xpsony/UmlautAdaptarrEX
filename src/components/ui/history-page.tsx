import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface HistoryPageProps {
  title: string;
  subtitle: string;
  listTitle: string;
  listSubtitle: string;
  emptyTitle: string;
  emptyHint: string;
  emptyIcon: ReactNode;
  isLoading: boolean;
  isEmpty: boolean;
  filterSlot: ReactNode;
  columns: string[];
  rows: ReactNode;
  /** Optional footer (e.g. pagination bar) rendered below the table. */
  footerSlot?: ReactNode;
}

/**
 * Skeleton variant of HistoryPage used by the loading.tsx of every history
 * page (sync-runs, rename-history, request-history). Mirrors the same
 * header + card + filter + rows shape so layout shift is minimal once data
 * resolves.
 */
export function HistoryPageSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-9 w-full sm:w-72" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2 p-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

/** Shared scaffold for admin list/history pages — header + card + filter + table. */
export function HistoryPage(props: HistoryPageProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
        <p className="text-sm text-muted-foreground">{props.subtitle}</p>
      </div>
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">{props.listTitle}</CardTitle>
              <CardDescription>{props.listSubtitle}</CardDescription>
            </div>
            {props.filterSlot}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {props.isLoading ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : props.isEmpty ? (
            <EmptyState
              icon={props.emptyIcon}
              title={props.emptyTitle}
              description={props.emptyHint}
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    {props.columns.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>{props.rows}</TableBody>
              </Table>
              {props.footerSlot}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
