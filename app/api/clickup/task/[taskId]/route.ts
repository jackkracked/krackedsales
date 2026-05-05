import { NextRequest, NextResponse } from "next/server";
import { clickup } from "@/lib/clickup/client";

export const dynamic = "force-dynamic";

interface ClickUpTaskDetail {
  id: string;
  name: string;
  custom_fields?: Array<{ id: string; name: string; value?: unknown }>;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  try {
    const task = await clickup.get<ClickUpTaskDetail>(`/task/${taskId}`);

    const brandHubField = task.custom_fields?.find(
      (f) => f.name.toLowerCase() === "brand hub"
    );

    let brandHubUrl: string | null = null;
    if (brandHubField?.value != null) {
      const v = brandHubField.value;
      if (typeof v === "string" && v.trim()) {
        brandHubUrl = v.trim();
      } else if (typeof v === "object" && v !== null) {
        const obj = v as Record<string, unknown>;
        const inner = obj.url ?? obj.value ?? obj.href;
        if (typeof inner === "string" && inner.trim()) brandHubUrl = inner.trim();
      }
    }

    // Debug — remove once confirmed working
    console.log(`[ClickUp task ${taskId}] brand_hub raw:`, JSON.stringify(brandHubField), "→", brandHubUrl);

    return NextResponse.json({ brandHubUrl });
  } catch (err) {
    console.error("[GET /api/clickup/task/:id]", err);
    return NextResponse.json({ brandHubUrl: null });
  }
}
