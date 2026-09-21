"use client";

import { useParams } from "next/navigation";
import { AutomationBuilder } from "@/app/dashboard/automations/automation-builder";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { ErrorState, LoadingState } from "@/components/data-state";
import type { AutomationRow } from "@/lib/api/types";

export default function EditAutomationPage() {
  const { tenantId } = useTenant();
  const params = useParams<{ id: string }>();
  const base = tenantId ? `/api/tenants/${tenantId}/automations/${params.id}` : null;
  const automation = useApi<{ automation: AutomationRow }>(base);

  if (!tenantId) return null;
  if (automation.loading) return <LoadingState rows={6} />;
  if (automation.error || !automation.data?.automation) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
        <ErrorState message={automation.error ?? "Automation not found"} onRetry={automation.reload} />
      </div>
    );
  }
  return <AutomationBuilder tenantId={tenantId} editAutomation={automation.data.automation} key={automation.data.automation.id} />;
}