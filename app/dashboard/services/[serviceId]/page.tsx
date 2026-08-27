"use client";

import { use, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  Clock,
  Save,
  Settings,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SchemaFieldList } from "@/components/booking/schema-field-list";
import { AvailabilityEditor } from "@/components/booking/availability-editor";
import { AIConversationPreview } from "@/components/booking/ai-conversation-preview";
import type {
  AppointmentServiceRow,
  AvailabilityRuleRow,
  BusinessRow,
  ResourceRow,
} from "@/lib/api/types";
import type { SchemaField } from "@/lib/booking/schema-types";

type Ctx = { params: Promise<{ serviceId: string }> };

export default function ServiceConfigPage({ params }: Ctx) {
  const { serviceId } = use(params);
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const serviceApi = useApi<{ service: AppointmentServiceRow }>(
    base ? `${base}/appointment-services/${serviceId}` : null
  );
  const schemaApi = useApi<{ schema: { id?: string; schema?: { fields?: SchemaField[] } } }>(
    base ? `${base}/appointment-services/${serviceId}/schema` : null
  );
  const businessesApi = useApi<{ businesses: BusinessRow[] }>(
    base ? `${base}/businesses` : null
  );
  const resourcesApi = useApi<{ resources: ResourceRow[] }>(
    base ? `${base}/resources` : null
  );
  const rulesApi = useApi<{ rules: AvailabilityRuleRow[] }>(
    base ? `${base}/availability-rules` : null
  );

  const loading = serviceApi.loading || schemaApi.loading;
  const error = serviceApi.error ?? schemaApi.error;
  const service = serviceApi.data?.service;

  // General settings state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("30");
  const [bookingMode, setBookingMode] = useState("duration");
  const [resourceType, setResourceType] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Schema state
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [savingSchema, setSavingSchema] = useState(false);

  // Synchronize initial data once loaded
  const [synced, setSynced] = useState(false);
  if (service && schemaApi.data && !synced) {
    setName(service.name);
    setDescription(service.description ?? "");
    setDuration(String(service.default_duration_minutes ?? 30));
    setBookingMode(service.booking_mode);
    setResourceType(service.requires_resource_type ?? "");
    setEnabled(service.enabled);
    setFields(schemaApi.data.schema?.schema?.fields ?? []);
    setSynced(true);
  }

  async function handleSaveGeneral(e: React.FormEvent) {
    e.preventDefault();
    if (!base || !service) return;

    setSavingGeneral(true);
    try {
      await api(`${base}/appointment-services/${service.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          bookingMode,
          defaultDurationMinutes: Number(duration) || 30,
          requiresResourceType: resourceType.trim() || null,
          enabled,
        }),
      });
      toast.success("General settings saved!");
      serviceApi.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSavingGeneral(false);
    }
  }

  async function handleSaveSchema(updatedFields: SchemaField[]) {
    setFields(updatedFields);
    if (!base || !service) return;

    setSavingSchema(true);
    try {
      await api(`${base}/appointment-services/${service.id}/schema`, {
        method: "PATCH",
        body: JSON.stringify({ fields: updatedFields }),
      });
      toast.success("Booking requirements saved!");
      schemaApi.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save requirements");
    } finally {
      setSavingSchema(false);
    }
  }

  if (loading) return <LoadingState rows={6} />;
  if (error || !service) return <ErrorState message={error ?? "Service not found"} />;

  const business = (businessesApi.data?.businesses ?? []).find(
    (b) => b.id === service.business_id
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2">
          <Link href="/dashboard/services">
            <ArrowLeft className="size-3.5 mr-1" />
            Back to Services
          </Link>
        </Button>
        <PageHeader
          title={service.name}
          description={`Configure requirements, duration, resources, and AI behavior for ${business?.name ?? "Business"}`}
        />
      </div>

      <Tabs defaultValue="requirements" className="space-y-6">
        <TabsList className="grid grid-cols-5 w-full sm:w-auto">
          <TabsTrigger value="general">
            <Settings className="size-3.5 mr-1.5" />
            General
          </TabsTrigger>
          <TabsTrigger value="requirements">
            <Wrench className="size-3.5 mr-1.5" />
            Requirements
          </TabsTrigger>
          <TabsTrigger value="resources">
            <Users className="size-3.5 mr-1.5" />
            Resources
          </TabsTrigger>
          <TabsTrigger value="availability">
            <Clock className="size-3.5 mr-1.5" />
            Availability
          </TabsTrigger>
          <TabsTrigger value="ai-preview">
            <Sparkles className="size-3.5 mr-1.5" />
            AI Preview
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: General */}
        <TabsContent value="general">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base">Service Settings</CardTitle>
              <CardDescription>
                Basic duration, booking mode, and status for this service.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveGeneral} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="s-name">Service Name</Label>
                  <Input
                    id="s-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="s-desc">Description</Label>
                  <Textarea
                    id="s-desc"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="s-duration">Duration (Minutes)</Label>
                    <Input
                      id="s-duration"
                      type="number"
                      min="5"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="s-resource-type">Required Resource Type</Label>
                    <Input
                      id="s-resource-type"
                      value={resourceType}
                      onChange={(e) => setResourceType(e.target.value)}
                      placeholder="e.g. Doctor, Stylist, Room"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label className="text-sm font-medium">Service Active</Label>
                    <p className="text-xs text-muted-foreground">
                      Enable or disable bookings for this service across AI and manual channels.
                    </p>
                  </div>
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>

                <Button type="submit" disabled={savingGeneral} className="mt-2">
                  <Save className="size-4" />
                  {savingGeneral ? "Saving..." : "Save Settings"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Booking Requirements Builder */}
        <TabsContent value="requirements" className="space-y-4">
          <SchemaFieldList fields={fields} onChange={handleSaveSchema} />
        </TabsContent>

        {/* Tab 3: Resources */}
        <TabsContent value="resources" className="space-y-4">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-base">Resource Requirements</CardTitle>
              <CardDescription>
                Assign staff, rooms, or equipment needed when a customer books this service.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Required Resource Type</Label>
                <Input
                  value={resourceType}
                  onChange={(e) => setResourceType(e.target.value)}
                  placeholder="e.g. Doctor, Room, Staff, Vehicle"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank if this service does not require a specific assigned resource.
                </p>
              </div>

              <div className="pt-3 border-t">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Available Tenant Resources
                </p>
                {(resourcesApi.data?.resources ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No resources created yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {resourcesApi.data?.resources.map((r) => (
                      <span key={r.id} className="rounded-md border px-2.5 py-1 text-xs bg-muted/40">
                        {r.name} · <span className="text-muted-foreground">{r.type}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Availability */}
        <TabsContent value="availability">
          <AvailabilityEditor
            base={base}
            businessId={service.business_id}
            resources={resourcesApi.data?.resources ?? []}
            rules={rulesApi.data?.rules ?? []}
            timezone={business?.timezone ?? "UTC"}
            onChanged={() => rulesApi.reload()}
          />
        </TabsContent>

        {/* Tab 5: AI Conversation Preview */}
        <TabsContent value="ai-preview">
          <AIConversationPreview serviceName={service.name} fields={fields} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
