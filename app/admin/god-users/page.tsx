"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ShieldPlus, Trash2, UserPlus } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { ErrorState, EmptyState, LoadingState } from "@/components/data-state";
import { formatDateTime } from "@/lib/format";

interface GodUserRow {
  id: string;
  email: string;
  created_at: string;
}

export default function GodUsersAdminPage() {
  const godUsers = useApi<{ godUsers: GodUserRow[] }>("/api/admin/god-users");

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await api("/api/admin/god-users", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      toast.success("God user added");
      setOpen(false);
      setEmail("");
      godUsers.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add god user");
    } finally {
      setBusy(false);
    }
  }

  async function remove(g: GodUserRow) {
    try {
      await api(`/api/admin/god-users/${g.id}`, { method: "DELETE" });
      toast.success("God user removed");
      godUsers.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove god user");
    }
  }

  const list = godUsers.data?.godUsers ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="God users" description="Emails that get platform admin access">
        <Button size="sm" onClick={() => setOpen(true)}>
          <ShieldPlus className="size-4" />
          Add god user
        </Button>
      </PageHeader>

      {godUsers.loading ? (
        <LoadingState rows={3} />
      ) : godUsers.error ? (
        <ErrorState message={godUsers.error} onRetry={godUsers.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          title="No god users"
          description="Add your email here to unlock the admin panel — access is checked by email on sign-in."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {g.email}
                      <Badge variant="secondary">god</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(g.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8 text-destructive">
                            <Trash2 className="size-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove god user?</AlertDialogTitle>
                            <AlertDialogDescription>
                              “{g.email}” will lose admin access on their next sign-in.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(g)}>Remove</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add god user</DialogTitle>
            <DialogDescription>Access is matched by email at sign-in, so use the same email they log in with.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="god-email">Email</Label>
            <Input id="god-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@company.com" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add} disabled={busy || !email.trim()}>
              {busy ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
