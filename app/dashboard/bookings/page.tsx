"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Filter,
  ListFilter,
  Plus,
  Search,
  User,
  X,
  XCircle,
} from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDateTime } from "@/lib/format";
import { BookingFormRenderer } from "@/components/booking/booking-form-renderer";
import { BookingDataDisplay } from "@/components/booking/booking-data-display";
import type {
  AppointmentServiceRow,
  BookingRow,
  BusinessRow,
  ResourceRow,
} from "@/lib/api/types";
import type { SchemaField } from "@/lib/booking/schema-types";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "confirmed" || status === "completed") return "default";
  if (status === "cancelled" || status === "no_show") return "destructive";
  return "secondary";
}

export default function BookingsPage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const bookingsApi = useApi<{ bookings: BookingRow[] }>(base ? `${base}/bookings` : null);
  const businessesApi = useApi<{ businesses: BusinessRow[] }>(base ? `${base}/businesses` : null);
  const servicesApi = useApi<{ services: AppointmentServiceRow[] }>(base ? `${base}/appointment-services` : null);
  const resourcesApi = useApi<{ resources: ResourceRow[] }>(base ? `${base}/resources` : null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedBooking, setSelectedBooking] = useState<BookingRow | null>(null);
  const [newBookingOpen, setNewBookingOpen] = useState(false);

  const loading = bookingsApi.loading || businessesApi.loading;
  const error = bookingsApi.error ?? businessesApi.error;
  const bookings = bookingsApi.data?.bookings ?? [];
  const businesses = businessesApi.data?.businesses ?? [];
  const services = servicesApi.data?.services ?? [];
  const resources = resourcesApi.data?.resources ?? [];

  // Filter bookings
  const filteredBookings = bookings.filter((b) => {
    const matchesStatus = statusFilter === "all" || b.status === statusFilter;
    const custName = b.customer?.full_name ?? b.customer?.phone_number ?? "";
    const sName = b.service?.name ?? "";
    const rName = b.resource?.name ?? "";
    const matchesSearch =
      !search ||
      custName.toLowerCase().includes(search.toLowerCase()) ||
      sName.toLowerCase().includes(search.toLowerCase()) ||
      rName.toLowerCase().includes(search.toLowerCase());

    return matchesStatus && matchesSearch;
  });

  const [cancelling, setCancelling] = useState(false);
  const [reminding, setReminding] = useState(false);

  async function handleCancelBooking(bookingId: string) {
    if (!base) return;
    setCancelling(true);
    try {
      await api(`${base}/bookings/${bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel", reason: "Cancelled by dashboard admin" }),
      });
      toast.success("Booking cancelled");
      setSelectedBooking(null);
      bookingsApi.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel booking");
    } finally {
      setCancelling(false);
    }
  }

  async function handleScheduleReminder(bookingId: string) {
    if (!base) return;
    setReminding(true);
    try {
      await api(`${base}/bookings/${bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reminder", hoursBefore: 24 }),
      });
      toast.success("Appointment reminder scheduled via WhatsApp!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to schedule reminder");
    } finally {
      setReminding(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Bookings"
        description="View and manage reservations, appointments, and rentals across your businesses"
      >
        <Button onClick={() => setNewBookingOpen(true)} size="sm">
          <Plus className="size-4" />
          New Booking
        </Button>
      </PageHeader>

      {loading ? (
        <LoadingState rows={6} />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            bookingsApi.reload();
            businessesApi.reload();
          }}
        />
      ) : (
        <div className="space-y-4">
          {/* Controls / Search bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search customer, service, resource..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <ListFilter className="size-3.5 mr-1" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Bookings Table */}
          {filteredBookings.length === 0 ? (
            <EmptyState
              title="No bookings found"
              description={
                search || statusFilter !== "all"
                  ? "Try adjusting your search or filters."
                  : "Confirmed customer bookings will appear here."
              }
            />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBookings.map((b) => (
                    <TableRow
                      key={b.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedBooking(b)}
                    >
                      <TableCell>
                        <div className="font-medium text-sm">
                          {b.customer?.full_name ?? "Customer"}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {b.customer?.phone_number ?? "No phone"}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{b.service?.name ?? "Service"}</TableCell>
                      <TableCell>
                        {b.resource?.name ? (
                          <Badge variant="outline" className="font-normal text-xs">
                            {b.resource.name}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Unresourced</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{formatDateTime(b.start_time)}</div>
                        {b.end_time && (
                          <div className="text-xs text-muted-foreground">
                            Until {formatDateTime(b.end_time)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(b.status)}>{b.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedBooking(b)}>
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Booking Detail Sheet */}
      <Sheet open={Boolean(selectedBooking)} onOpenChange={(open) => !open && setSelectedBooking(null)}>
        {selectedBooking && (
          <SheetContent className="sm:max-w-md overflow-y-auto space-y-6">
            <SheetHeader className="border-b pb-4">
              <div className="flex items-center justify-between">
                <Badge variant={statusVariant(selectedBooking.status)}>
                  {selectedBooking.status}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  ID: {selectedBooking.id.slice(0, 8)}
                </span>
              </div>
              <SheetTitle className="text-lg pt-1">
                {selectedBooking.service?.name ?? "Booking Details"}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {selectedBooking.business?.name ?? "Business"}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4">
              {/* Customer Card */}
              <div className="rounded-lg border p-3 bg-muted/20 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Customer
                </p>
                <p className="font-medium text-sm">
                  {selectedBooking.customer?.full_name ?? "Guest Customer"}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  {selectedBooking.customer?.phone_number ?? "No phone"}
                </p>
              </div>

              {/* Time & Resource Card */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="font-semibold text-muted-foreground uppercase">Start Time</p>
                  <p className="font-medium text-foreground">{formatDateTime(selectedBooking.start_time)}</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <p className="font-semibold text-muted-foreground uppercase">Resource</p>
                  <p className="font-medium text-foreground">
                    {selectedBooking.resource?.name ?? "Unresourced"}
                  </p>
                </div>
              </div>

              {/* Actions Card */}
              <div className="pt-2 border-t space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Booking Actions
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={reminding}
                    onClick={() => handleScheduleReminder(selectedBooking.id)}
                  >
                    <Bell className="size-3.5 mr-1" />
                    {reminding ? "Sending..." : "Send Reminder"}
                  </Button>

                  {selectedBooking.status !== "cancelled" && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" disabled={cancelling}>
                          <XCircle className="size-3.5 mr-1" />
                          Cancel
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Cancel Appointment?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will mark the booking as cancelled and release the time slot and resource.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep Booking</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleCancelBooking(selectedBooking.id)}>
                            Cancel Booking
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>

              {/* Dynamic Schema Booking Data */}
              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Collected Booking Data
                </p>
                <BookingDataDisplay data={selectedBooking.booking_data} />
              </div>
            </div>
          </SheetContent>
        )}
      </Sheet>

      {/* New Manual Booking Dialog */}
      <NewBookingModal
        open={newBookingOpen}
        onOpenChange={setNewBookingOpen}
        base={base}
        businesses={businesses}
        services={services}
        resources={resources}
        onCreated={() => bookingsApi.reload()}
      />
    </div>
  );
}

function NewBookingModal({
  open,
  onOpenChange,
  base,
  businesses,
  services,
  resources,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  base: string | null;
  businesses: BusinessRow[];
  services: AppointmentServiceRow[];
  resources: ResourceRow[];
  onCreated: () => void;
}) {
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [serviceId, setServiceId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [bookingData, setBookingData] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  // Fetch active schema for selected service
  const serviceSchemaApi = useApi<{ schema: { schema?: { fields: SchemaField[] } } }>(
    base && serviceId ? `${base}/appointment-services/${serviceId}/schema` : null
  );

  const fields = serviceSchemaApi.data?.schema?.schema?.fields ?? [];
  const selectedService = services.find((s) => s.id === serviceId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!base || !businessId || !serviceId || !startTime) return;

    setSubmitting(true);
    try {
      const computedEnd =
        endTime ||
        new Date(
          new Date(startTime).getTime() +
            (selectedService?.default_duration_minutes ?? 30) * 60000
        ).toISOString();

      await api(`${base}/bookings`, {
        method: "POST",
        body: JSON.stringify({
          businessId,
          serviceId,
          resourceId: resourceId || null,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(computedEnd).toISOString(),
          bookingData,
        }),
      });

      toast.success("Manual booking created successfully!");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Manual Booking</DialogTitle>
          <DialogDescription>
            Create a booking on behalf of a customer using the service&apos;s dynamic schema requirements.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Business</label>
            <Select value={businessId} onValueChange={setBusinessId}>
              <SelectTrigger>
                <SelectValue placeholder="Select business..." />
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Service</label>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select service..." />
              </SelectTrigger>
              <SelectContent>
                {services
                  .filter((s) => !businessId || s.business_id === businessId)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.default_duration_minutes ?? 30}m)
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Start Date & Time</label>
              <Input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Resource (Optional)</label>
              <Select value={resourceId} onValueChange={setResourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Any resource" />
                </SelectTrigger>
                <SelectContent>
                  {resources.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Render dynamic schema fields for selected service */}
          {serviceId && (
            <div className="pt-2 border-t space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Service Requirements
              </p>
              {serviceSchemaApi.loading ? (
                <p className="text-xs text-muted-foreground">Loading requirements...</p>
              ) : (
                <BookingFormRenderer
                  fields={fields}
                  values={bookingData}
                  onChange={setBookingData}
                  resources={resources}
                />
              )}
            </div>
          )}

          <DialogFooter className="pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !businessId || !serviceId || !startTime}>
              {submitting ? "Creating..." : "Create Booking"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
