import { useQuery } from "@tanstack/react-query";
import type { EnrichedTask } from "@/app/api/clickup/tasks/route";
import type { DemoLinkData } from "@/app/api/demo-tracker/ghl-links/route";
import { getTimeRangeStart, type TimeRange } from "@/lib/utils/time-range";

type LinksMap = Record<string, DemoLinkData>;

async function fetchLinks(tasks: EnrichedTask[], range: TimeRange): Promise<LinksMap> {
  const rangeStart = getTimeRangeStart(range);

  // Only send tasks that fall within the current range — this ensures the
  // 10-per-request processing quota is spent on tasks visible on screen,
  // not on older tasks that aren't relevant to the current view.
  const sentTasks = tasks
    .filter((t) => {
      if (t.bucket !== "DEMO_SENT" || !t.dateSent) return false;
      if (!rangeStart) return true; // "all time" — include everything
      return new Date(t.dateSent) >= rangeStart;
    })
    .map((t) => ({ id: t.id, name: t.name, dateSent: t.dateSent!, brandHubUrl: t.brandHubUrl }));

  if (sentTasks.length === 0) return {};

  const res = await fetch("/api/demo-tracker/ghl-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tasks: sentTasks }),
  });

  if (!res.ok) return {};
  const data = await res.json() as { links: LinksMap };
  return data.links ?? {};
}

export function useDemoGhlLinks(tasks: EnrichedTask[], range: TimeRange) {
  // Key on range + how many tasks in that range have dateSent populated.
  // Changing the range or new dateSent values both trigger a fresh fetch.
  const sentWithDateCount = tasks.filter((t) => {
    if (t.bucket !== "DEMO_SENT" || !t.dateSent) return false;
    const start = getTimeRangeStart(range);
    if (!start) return true;
    return new Date(t.dateSent) >= start;
  }).length;

  return useQuery<LinksMap>({
    queryKey: ["demo-ghl-links", range, sentWithDateCount],
    queryFn: () => fetchLinks(tasks, range),
    enabled: sentWithDateCount > 0,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
