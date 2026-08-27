"use client";

import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Card, CardContent } from "@/components/ui/card";
import { AvailabilityEditor } from "@/components/booking/availability-editor";
import type { AvailabilityRuleRow, BusinessRow, ResourceRow } from "@/lib/api/types";

export default function AvailabilityPage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const businessesApi = useApi<{ businesses: BusinessRow[] }>(base ? `${base}/businesses` : null);
  const resourcesApi = useApi<{ resources: ResourceRow[] }>(base ? `${base}/resources` : null);
  const rulesApi = useApi<{ rules: AvailabilityRuleRow[] }>(base ? `${base}/availability-rules` : null);

  const loading = businessesApi.loading || resourcesApi.loading || rulesApi.loading;
  const error = businessesApi.error ?? resourcesApi.error ?? rulesApi.error;
  const businesses = businessesApi.data?.businesses ?? [];
  const resources = resourcesApi.data?.resources ?? [];
  const rules = rulesApi.data?.rules ?? [];

  const firstBusiness = businesses[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Availability Schedule"
        description="Define weekly open hours for your businesses and resources"
      />

      {loading ? (
        <LoadingState rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => rulesApi.reload()} />
      ) : !firstBusiness ? (
        <Card>
          <CardContent className="p-8 text-center">
            <EmptyState
              title="Create a business first"
              description="Availability rules attach to a business profile."
            />
          </CardContent>
        </Card>
      ) : (
        <AvailabilityEditor
          base={base}
          businessId={firstBusiness.id}
          resources={resources}
          rules={rules}
          timezone={firstBusiness.timezone ?? "UTC"}
          onChanged={() => rulesApi.reload()}
        />
      )}
    </div>
  );
}
