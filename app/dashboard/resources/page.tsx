"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Users, UserCheck } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BusinessRow, ResourceRow } from "@/lib/api/types";

const SUGGESTED_RESOURCE_TYPES = [
  "Doctor",
  "Staff",
  "Room",
  "Trainer",
  "Table",
  "Vehicle",
  "Equipment",
  "Custom",
];

export default function ResourcesPage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const resourcesApi = useApi<{ resources: ResourceRow[] }>(base ? `${base}/resources` : null);
  const businessesApi = useApi<{ businesses: BusinessRow[] }>(base ? `${base}/businesses` : null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("Doctor");
  const [customType, setCustomType] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [businessId, setBusinessId] = useState("");
  const [saving, setSaving] = useState(false);

  const resources = resourcesApi.data?.resources ?? [];
  const businesses = businessesApi.data?.businesses ?? [];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const targetBizId = businessId || businesses[0]?.id;
    if (!base || !targetBizId || !name.trim()) return;

    setSaving(true);
    try {
      const finalType = type === "Custom" ? customType.trim() || "custom" : type;
      await api(`${base}/resources`, {
        method: "POST",
        body: JSON.stringify({
          businessId: targetBizId,
          name: name.trim(),
          type: finalType,
          capacity: Number(capacity) || 1,
        }),
      });
      toast.success("Resource created successfully");
      setCreateOpen(false);
      setName("");
      resourcesApi.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create resource");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Bookable Resources"
        description="People, rooms, tables, vehicles, or equipment whose slot availability is booked"
      >
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="size-4" />
          Add Resource
        </Button>
      </PageHeader>

      {resourcesApi.loading || businessesApi.loading ? (
        <LoadingState rows={5} />
      ) : resourcesApi.error ? (
        <ErrorState message={resourcesApi.error} onRetry={() => resourcesApi.reload()} />
      ) : resources.length === 0 ? (
        <Card border-dashed>
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <Users className="size-10 text-muted-foreground/60 mb-2" />
            <p className="font-semibold text-base">No bookable resources added</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Add staff members, rooms, tables, or equipment to prevent double-booking.
            </p>
            <Button onClick={() => setCreateOpen(true)} className="mt-4" size="sm">
              <Plus className="size-4" />
              Add First Resource
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resource Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.type}</Badge>
                  </TableCell>
                  <TableCell className="text-sm font-mono">{r.capacity ?? 1}</TableCell>
                  <TableCell>
                    <Badge variant={r.enabled ? "default" : "secondary"}>
                      {r.enabled ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Bookable Resource</DialogTitle>
            <DialogDescription>
              Create a staff member, room, table, or equipment item.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 py-2">
            {businesses.length > 0 && (
              <div className="space-y-2">
                <Label>Business</Label>
                <Select value={businessId || businesses[0]?.id} onValueChange={setBusinessId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {businesses.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="res-name">Resource Name</Label>
              <Input
                id="res-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dr. Arjun Kumar, Deluxe Room 101, Trainer Rahul"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Resource Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUGGESTED_RESOURCE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {type === "Custom" && (
              <div className="space-y-2">
                <Label htmlFor="custom-type">Custom Type Name</Label>
                <Input
                  id="custom-type"
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  placeholder="e.g. Kayak, Studio B"
                  required
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="res-capacity">Capacity / Concurrent Slots</Label>
              <Input
                id="res-capacity"
                type="number"
                min="1"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? "Creating..." : "Add Resource"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
