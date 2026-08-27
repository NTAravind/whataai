"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CalendarClock,
  Clock,
  Copy,
  Pencil,
  Plus,
  Settings2,
  Sparkles,
  SwitchCamera,
  Trash2,
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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { AppointmentServiceRow, BusinessRow } from "@/lib/api/types";
import type { SchemaField } from "@/lib/booking/schema-types";

// Quick Start Starter Templates
const STARTER_TEMPLATES: {
  name: string;
  category: string;
  description: string;
  duration: number;
  bookingMode: string;
  fields: SchemaField[];
}[] = [
  {
    name: "General Medical Consultation",
    category: "Clinic",
    description: "In-clinic patient doctor consultation",
    duration: 30,
    bookingMode: "duration",
    fields: [
      { id: "customer_name", label: "Patient Name", type: "text", required: true, role: "customer_name", ai: { question: "May I have the patient's full name?" } },
      { id: "customer_phone", label: "Phone Number", type: "phone", required: true, role: "customer_phone", ai: { question: "What is your contact phone number?" } },
      { id: "booking_date", label: "Appointment Date", type: "date", required: true, role: "booking_date", ai: { question: "Which date would you like to visit?" } },
      { id: "booking_start", label: "Appointment Time", type: "time", required: true, role: "booking_start", ai: { question: "What time works best for you?" } },
      { id: "symptoms", label: "Symptoms / Reason", type: "long_text", required: false, role: "notes", ai: { question: "Could you briefly describe your symptoms or reason for visit?" } },
    ],
  },
  {
    name: "Deluxe Room Stay",
    category: "Hotel",
    description: "Overnight room reservation",
    duration: 1440,
    bookingMode: "multi_day",
    fields: [
      { id: "customer_name", label: "Guest Name", type: "text", required: true, role: "customer_name", ai: { question: "Under what name should the reservation be made?" } },
      { id: "customer_phone", label: "Phone Number", type: "phone", required: true, role: "customer_phone", ai: { question: "What is your contact phone number?" } },
      { id: "check_in", label: "Check-in Date", type: "date", required: true, role: "booking_date", ai: { question: "What is your check-in date?" } },
      { id: "check_out", label: "Check-out Date", type: "date", required: true, role: "booking_end", ai: { question: "What is your check-out date?" } },
      { id: "guests", label: "Number of Guests", type: "guests", required: true, role: "guests", ai: { question: "How many guests will be staying?" } },
    ],
  },
  {
    name: "Haircut & Styling",
    category: "Salon",
    description: "Salon styling session with stylist choice",
    duration: 45,
    bookingMode: "duration",
    fields: [
      { id: "customer_name", label: "Client Name", type: "text", required: true, role: "customer_name", ai: { question: "Can I have your name for the booking?" } },
      { id: "customer_phone", label: "Phone Number", type: "phone", required: true, role: "customer_phone", ai: { question: "What phone number can we reach you at?" } },
      { id: "booking_date", label: "Preferred Date", type: "date", required: true, role: "booking_date", ai: { question: "Which date would you like to schedule?" } },
      { id: "booking_start", label: "Preferred Time", type: "time", required: true, role: "booking_start", ai: { question: "What time would you prefer?" } },
      { id: "stylist", label: "Preferred Stylist", type: "resource", required: false, role: "staff", ai: { question: "Do you have a preferred stylist?" } },
    ],
  },
  {
    name: "Personal Training Session",
    category: "Gym",
    description: "1-on-1 fitness coaching session",
    duration: 60,
    bookingMode: "duration",
    fields: [
      { id: "customer_name", label: "Member Name", type: "text", required: true, role: "customer_name", ai: { question: "What is your name?" } },
      { id: "customer_phone", label: "Phone Number", type: "phone", required: true, role: "customer_phone", ai: { question: "What is your phone number?" } },
      { id: "booking_date", label: "Session Date", type: "date", required: true, role: "booking_date", ai: { question: "What date would you like to train?" } },
      { id: "booking_start", label: "Session Time", type: "time", required: true, role: "booking_start", ai: { question: "What time is best for your session?" } },
      { id: "trainer", label: "Trainer", type: "resource", required: false, role: "staff", ai: { question: "Which trainer would you like to train with?" } },
    ],
  },
];

export default function ServicesPage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const servicesApi = useApi<{ services: AppointmentServiceRow[] }>(base ? `${base}/appointment-services` : null);
  const businessesApi = useApi<{ businesses: BusinessRow[] }>(base ? `${base}/businesses` : null);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState("all");

  // Create Form State
  const [name, setName] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("30");
  const [bookingMode, setBookingMode] = useState("duration");
  const [saving, setSaving] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<typeof STARTER_TEMPLATES[0] | null>(null);

  const services = servicesApi.data?.services ?? [];
  const businesses = businessesApi.data?.businesses ?? [];

  const filteredServices = services.filter(
    (s) => selectedBusiness === "all" || s.business_id === selectedBusiness
  );

  function applyTemplate(tpl: typeof STARTER_TEMPLATES[0]) {
    setSelectedTemplate(tpl);
    setName(tpl.name);
    setDescription(tpl.description);
    setDuration(String(tpl.duration));
    setBookingMode(tpl.bookingMode);
  }

  async function handleCreateService(e: React.FormEvent) {
    e.preventDefault();
    const targetBizId = businessId || businesses[0]?.id;
    if (!base || !targetBizId || !name.trim()) return;

    setSaving(true);
    try {
      const res = await api<{ service: AppointmentServiceRow }>(`${base}/appointment-services`, {
        method: "POST",
        body: JSON.stringify({
          businessId: targetBizId,
          name: name.trim(),
          description: description.trim() || null,
          bookingMode,
          defaultDurationMinutes: Number(duration) || 30,
        }),
      });

      // If a template was selected, push its schema fields
      if (selectedTemplate && res.service?.id) {
        await api(`${base}/appointment-services/${res.service.id}/schema`, {
          method: "PATCH",
          body: JSON.stringify({ fields: selectedTemplate.fields }),
        });
      }

      toast.success("Service created successfully!");
      setCreateOpen(false);
      setName("");
      setDescription("");
      setSelectedTemplate(null);
      servicesApi.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create service");
    } finally {
      setSaving(false);
    }
  }

  async function toggleService(service: AppointmentServiceRow, enabled: boolean) {
    if (!base) return;
    try {
      await api(`${base}/appointment-services/${service.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      toast.success(enabled ? "Service enabled" : "Service disabled");
      servicesApi.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update service");
    }
  }

  async function handleDelete(serviceId: string) {
    if (!base) return;
    try {
      await api(`${base}/appointment-services/${serviceId}`, { method: "DELETE" });
      toast.success("Service deleted");
      servicesApi.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete service");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Services"
        description="Bookable offerings (consultations, stays, sessions, tickets) configured with dynamic schemas"
      >
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="size-4" />
          Create Service
        </Button>
      </PageHeader>

      {servicesApi.loading || businessesApi.loading ? (
        <LoadingState rows={5} />
      ) : servicesApi.error ? (
        <ErrorState message={servicesApi.error} onRetry={() => servicesApi.reload()} />
      ) : (
        <div className="space-y-4">
          {/* Controls */}
          {businesses.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Filter by Business:</span>
              <Select value={selectedBusiness} onValueChange={setSelectedBusiness}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="All Businesses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Businesses</SelectItem>
                  {businesses.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {filteredServices.length === 0 ? (
            <EmptyState
              title="No services configured"
              description="Create a service to start offering bookable appointments or reservations."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service Name</TableHead>
                    <TableHead>Mode / Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-36 text-right">Configure</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredServices.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{s.name}</div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {s.description ?? "No description"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal text-xs capitalize">
                          {s.booking_mode} · {s.default_duration_minutes ?? 30}m
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={s.enabled}
                            onCheckedChange={(c) => toggleService(s, c)}
                          />
                          <Badge variant={s.enabled ? "default" : "secondary"}>
                            {s.enabled ? "Active" : "Disabled"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/dashboard/services/${s.id}`}>
                            <Settings2 className="size-3.5" />
                            Configure
                          </Link>
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8 text-destructive">
                              <Trash2 className="size-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Service?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Delete &quot;{s.name}&quot; and its associated requirements schema and bookings.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(s.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Create Service Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Bookable Service</DialogTitle>
            <DialogDescription>
              Choose a quick-start template or configure a custom service from scratch.
            </DialogDescription>
          </DialogHeader>

          {/* Quick-start presets */}
          <div className="space-y-2 py-1">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Starter Templates (Optional)
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {STARTER_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className={`flex flex-col items-start rounded-lg border p-2.5 text-left text-xs transition-colors ${
                    selectedTemplate?.name === tpl.name
                      ? "border-primary bg-primary/5"
                      : "hover:border-primary/50"
                  }`}
                >
                  <span className="font-medium text-foreground">{tpl.name}</span>
                  <span className="text-muted-foreground truncate w-full mt-0.5">{tpl.category}</span>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleCreateService} className="space-y-4 pt-3 border-t">
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
              <Label htmlFor="svc-name">Service Name</Label>
              <Input
                id="svc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. General Consultation"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="svc-duration">Default Duration (min)</Label>
                <Input
                  id="svc-duration"
                  type="number"
                  min="5"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Booking Mode</Label>
                <Select value={bookingMode} onValueChange={setBookingMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="duration">Fixed Duration (Slot)</SelectItem>
                    <SelectItem value="multi_day">Multi-Day (Hotel / Stay)</SelectItem>
                    <SelectItem value="open">Open / Flexible</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="svc-desc">Description</Label>
              <Textarea
                id="svc-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What customers are booking..."
              />
            </div>

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? "Creating..." : "Create & Configure"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
