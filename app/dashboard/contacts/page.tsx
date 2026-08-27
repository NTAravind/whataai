"use client";

import { useState } from "react";
import { Plus, Search, Edit, Trash2, Phone, Mail, X } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";

interface Contact {
  id: string;
  tenant_id: string;
  full_name: string | null;
  phone_number: string | null;
  email: string | null;
  opt_out: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export default function ContactsPage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const contactsApi = useApi<{ contacts: Contact[] }>(base ? `${base}/contacts` : null);
  const [search, setSearch] = useState("");
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [formData, setFormData] = useState({ full_name: "", phone_number: "", email: "" });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredContacts = contactsApi.data?.contacts
    ?.filter(
      (c) =>
        c.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.phone_number?.toLowerCase().includes(search.toLowerCase()) ||
        c.email?.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) ?? [];

  function openCreateDialog() {
    setEditingContact(null);
    setFormData({ full_name: "", phone_number: "", email: "" });
  }

  function openEditDialog(contact: Contact) {
    setEditingContact(contact);
    setFormData({
      full_name: contact.full_name ?? "",
      phone_number: contact.phone_number ?? "",
      email: contact.email ?? "",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingContact) {
        const res = await fetch(`${base}/contacts/${editingContact.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (!res.ok) throw new Error("Failed to update contact");
        toast.success("Contact updated");
      } else {
        if (!formData.phone_number && !formData.email) {
          toast.error("Phone number or email is required");
          return;
        }
        const res = await fetch(`${base}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (!res.ok) throw new Error("Failed to create contact");
        toast.success("Contact created");
      }
      contactsApi.reload();
      setEditingContact(null);
    } catch {
      toast.error(editingContact ? "Failed to update contact" : "Failed to create contact");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this contact? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${base}/contacts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete contact");
      toast.success("Contact deleted");
      contactsApi.reload();
    } catch {
      toast.error("Failed to delete contact");
    } finally {
      setDeletingId(null);
    }
  }

  const loading = contactsApi.loading;
  const error = contactsApi.error;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Contacts"
        description="Manage customer contacts for this tenant"
      >
        <Dialog open={!!editingContact || false} onOpenChange={(open) => !open && setEditingContact(null)}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog}><Plus className="size-4 mr-2" />Add Contact</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{editingContact ? "Edit Contact" : "Add Contact"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="full_name">Full Name</Label>
                  <Input
                    id="full_name"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="John Doe"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone_number">Phone Number</Label>
                  <Input
                    id="phone_number"
                    type="tel"
                    value={formData.phone_number}
                    onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                    placeholder="+1 555 123 4567"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="john@example.com"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingContact(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={contactsApi.loading}>
                  {editingContact ? "Save Changes" : "Create Contact"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {loading ? (
        <div className="space-y-4" aria-busy="true">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-16" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-500">Error loading contacts: {error}</div>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle className="text-base">All Contacts ({filteredContacts.length})</CardTitle>
              <div className="relative max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, phone, email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {filteredContacts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {search ? "No contacts match your search." : "No contacts yet. Click \"Add Contact\" to get started."}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">{contact.full_name ?? "—"}</TableCell>
                      <TableCell>
                        {contact.phone_number ? (
                          <span className="flex items-center gap-1">
                            <Phone className="size-3 text-muted-foreground" />
                            {contact.phone_number}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {contact.email ? (
                          <span className="flex items-center gap-1">
                            <Mail className="size-3 text-muted-foreground" />
                            {contact.email}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={contact.opt_out ? "destructive" : "default"}>
                          {contact.opt_out ? "Opted Out" : "Active"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {formatDateTime(contact.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(contact)}
                            disabled={contactsApi.loading}
                          >
                            <Edit className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(contact.id)}
                            disabled={deletingId === contact.id || contactsApi.loading}
                          >
                            {deletingId === contact.id ? (
                              <span className="animate-spin">⏳</span>
                            ) : (
                              <Trash2 className="size-4 text-red-500" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}