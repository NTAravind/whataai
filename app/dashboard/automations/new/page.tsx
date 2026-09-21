"use client";

import { AutomationBuilder } from "@/app/dashboard/automations/automation-builder";
import { useTenant } from "@/components/providers/tenant-provider";

export default function NewAutomationPage() {
  const { tenantId } = useTenant();
  if (!tenantId) return null;
  return <AutomationBuilder tenantId={tenantId} editAutomation={null} />;
}