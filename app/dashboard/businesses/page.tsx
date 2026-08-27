"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Briefcase, Building2, CalendarDays, Globe, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { BusinessRow } from "@/lib/api/types";

const BUSINESS_TYPES = [
  { value: "Clinic", label: "Clinic / Healthcare", icon: "🏥" },
  { value: "Hotel", label: "Hotel / Hospitality", icon: "🏨" },
  { value: "Salon", label: "Salon / Spa", icon: "✂️" },
  { value: "Gym", label: "Gym / Personal Training", icon: "🏋️" },
  { value: "Restaurant", label: "Restaurant / Dining", icon: "🍽️" },
  { value: "Event", label: "Event / Ticketing", icon: "🎟️" },
  { value: "Professional Service", label: "Consulting / Professional Service", icon: "💼" },
  { value: "Rental", label: "Vehicle / Equipment Rental", icon: "🚗" },
  { value: "Other", label: "Other Custom Booking", icon: "⚡" },
];

const TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Paris",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export default function BusinessesPage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const businessesApi = useApi<{ businesses: BusinessRow[] }>(base ? `${base}/businesses` : null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<BusinessRow | null>(null);

  // Form states
  const [name, setName] = useState("");
  const [type, setType] = useState("Clinic");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);

  const businesses = businessesApi.data?.businesses ?? [];

  function openCreate() {
    setName("");
    setType("Clinic");
    setTimezone("Asia/Kolkata");
    setDescription("");
    setLocation("");
    setEditingBusiness(null);
    setCreateOpen(true);
  }

  function openEdit(b: BusinessRow) {
    setEditingBusiness(b);
    setName(b.name);
    setType(b.industry ?? "Clinic");
    setTimezone(b.timezone ?? "UTC");
    setDescription(String(b.metadata?.description ?? ""));
    setLocation(String(b.metadata?.location ?? ""));
    setCreateOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!base || !name.trim()) return;

    setSaving(true);
    try {
      if (editingBusiness) {
        await api(`${base}/businesses/${editingBusiness.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            industry: type,
            timezone,
            metadata: {
              ...editingBusiness.metadata,
              description: description.trim() || undefined,
              location: location.trim() || undefined,
            },
          }),
        });
        toast.success("Business profile updated");
      } else {
        await api(`${base}/businesses`, {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            industry: type,
            timezone,
            metadata: {
              description: description.trim() || undefined,
              location: location.trim() || undefined,
            },
          }),
        });
        toast.success("Business profile created");
      }

      setCreateOpen(false);
      businessesApi.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save business");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(bId: string) {
    if (!base) return;
    try {
      await api(`${base}/businesses/${bId}`, { method: "DELETE" });
      toast.success("Business deleted");
      businessesApi.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete business");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Businesses"
        description="Configure business profiles, locations, and timezones that anchor your booking services"
      >
        <Button onClick={openCreate} size="sm">
          <Plus className="size-4" />
          Add Business
        </Button>
      </PageHeader>

      {businessesApi.loading ? (
        <LoadingState rows={4} />
      ) : businessesApi.error ? (
        <ErrorState message={businessesApi.error} onRetry={() => businessesApi.reload()} />
      ) : businesses.length === 0 ? (
        <Card border-dashed>
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <Building2 className="size-10 text-muted-foreground/60 mb-2" />
            <p className="font-semibold text-base">No businesses created yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Create your first business profile to start setting up services, staff resources, and AI agents.
            </p>
            <Button onClick={openCreate} className="mt-4" size="sm">
              <Plus className="size-4" />
              Create Business
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {businesses.map((b) => {
            const typeInfo = BUSINESS_TYPES.find((t) => t.value === b.industry);
            return (
              <Card key={b.id} className="flex flex-col justify-between hover:border-ring transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xl" title={b.industry ?? "Business"}>
                      {typeInfo?.icon ?? "🏢"}
                    </span>
                    <Badge variant="outline">{b.industry ?? "General"}</Badge>
                  </div>
                  <CardTitle className="text-lg font-semibold pt-2">{b.name}</CardTitle>
                  <CardDescription className="text-xs flex items-center gap-1">
                    <Globe className="size-3" /> Timezone: {b.timezone}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  {b.metadata?.location ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                      <MapPin className="size-3 text-muted-foreground/70" />
                      {String(b.metadata.location)}
                    </p>
                  ) : null}

                  {b.metadata?.description ? (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {String(b.metadata.description)}
                    </p>
                  ) : null}

                  <div className="flex items-center justify-end gap-1 pt-2 border-t">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(b)}>
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive">
                          <Trash2 className="size-3.5" />
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Business?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete &quot;{b.name}&quot; and all attached services, rules, and resources.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(b.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBusiness ? "Edit Business" : "Create Business Profile"}</DialogTitle>
            <DialogDescription>
              Set up your business context and timezone for AI booking scheduling.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="biz-name">Business Name</Label>
              <Input
                id="biz-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Smile Dental Clinic"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Business Type / Industry</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_TYPES.map((bt) => (
                    <SelectItem key={bt.value} value={bt.value}>
                      <span className="mr-2">{bt.icon}</span> {bt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="biz-location">Location / Address</Label>
              <Input
                id="biz-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Indiranagar, Bangalore"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="biz-desc">Description</Label>
              <Textarea
                id="biz-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of services provided..."
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? "Saving..." : editingBusiness ? "Save Changes" : "Create Business"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
