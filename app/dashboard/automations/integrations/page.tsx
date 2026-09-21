"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Plus, Plug, Trash2 } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import type { IntegrationRow } from "@/lib/api/types";

interface OAuthProviderInfo {
  id: string;
  scopes: string[];
  clientId: string | null;
  configured: boolean;
}

export default function IntegrationsPage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}` : null;

  const integrations = useApi<{ integrations: IntegrationRow[] }>(
    base ? `${base}/integrations` : null,
  );
  const oauth = useApi<{ providers: OAuthProviderInfo[] }>(
    base ? `${base}/integrations/oauth/status` : null,
  );

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("generic");
  const [baseUrl, setBaseUrl] = useState("");
  const [credential, setCredential] = useState("");

  const list = integrations.data?.integrations ?? [];
  const providers = oauth.data?.providers ?? [];

  async function create() {
    if (!tenantId) return;
    setCreating(true);
    try {
      await api(`${base}/integrations`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          type: type.trim(),
          baseUrl: baseUrl.trim() || undefined,
          credential: credential.trim() || undefined,
        }),
      });
      toast.success("Integration created");
      setName("");
      setType("generic");
      setBaseUrl("");
      setCredential("");
      integrations.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create integration");
    } finally {
      setCreating(false);
    }
  }

  async function remove(integration: IntegrationRow) {
    if (!tenantId) return;
    try {
      await api(`${base}/integrations/${integration.id}`, { method: "DELETE" });
      toast.success("Integration deleted");
      integrations.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete integration");
    }
  }

  async function oauthStart(provider: OAuthProviderInfo) {
    if (!tenantId) return;
    try {
      const res = await api<{ authorizeUrl: string }>(
        `${base}/integrations/oauth/start?provider=${provider.id}&integrationName=${encodeURIComponent(
          name.trim() || provider.id,
        )}`,
      );
      window.location.assign(res.authorizeUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start OAuth handshake");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Integrations"
        description="External services an automation can call. Non-OAuth credentials are exposed to steps as"
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/automations">
            <ArrowLeft className="size-4" />
            Back to automations
          </Link>
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" />
              New integration
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add an integration</DialogTitle>
              <DialogDescription>
                Pick an OAuth provider to connect, or add a generic API integration with a manual
                credential.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="integration-name">Name</Label>
                <Input
                  id="integration-name"
                  placeholder="e.g. My CRM"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generic">Generic API</SelectItem>
                    <SelectItem value="zoho_invoice">Zoho Invoice</SelectItem>
                    <SelectItem value="quickbooks">QuickBooks</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {providers.filter((p) => p.id === type && p.configured).length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => oauthStart(providers.find((p) => p.id === type)!)}
                >
                  <Plug className="size-4" />
                  Connect via OAuth
                </Button>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="integration-baseurl">Base URL (optional)</Label>
                <Input
                  id="integration-baseurl"
                  placeholder="https://api.example.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="integration-credential">API credential</Label>
                <Input
                  id="integration-credential"
                  type="password"
                  placeholder="secret key"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Reference it in any step as{" "}
                  <code className="font-mono">{"{{integration.credential}}"}</code> — e.g.{" "}
                  <code className="font-mono">Authorization: Bearer {"{{integration.credential}}"}</code>.
                  OAuth connections skip this field.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={create}
                disabled={creating || !name.trim() || !type.trim()}
              >
                {creating ? "Creating…" : "Add integration"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Plug className="size-4" />
        <span>
          The credential token <code className="font-mono">{"{{integration.credential}}"}</code> is the
          only way to reference a credential — request headers are never auto-injected for generic
          integrations.
        </span>
      </div>

      {integrations.loading ? (
        <LoadingState rows={3} />
      ) : integrations.error ? (
        <ErrorState message={integrations.error} onRetry={integrations.reload} />
      ) : list.length === 0 ? (
        <EmptyState
          title="No integrations yet"
          description="Add your CRM or accounting system above so automations can call it after a customer conversation."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Base URL</TableHead>
                <TableHead>Credential</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.name}</TableCell>
                  <TableCell>
                    <Badge variant={i.type !== "generic" ? "default" : "secondary"}>{i.type}</Badge>
                  </TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-xs text-muted-foreground">
                    {i.base_url ?? "—"}
                  </TableCell>
                  <TableCell>
                    {i.hasCredentials ? (
                      <Badge variant="outline">set</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">none</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(i.createdAt)}</TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 text-destructive">
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete “{i.name}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Automations referencing this integration will fail until you remove their
                            api_call steps or switch them.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remove(i)}>Delete</AlertDialogAction>
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

      {providers.filter((p) => !p.configured).length > 0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">OAuth providers need an operator to configure secrets</p>
          <p className="mt-1">
            {providers
              .filter((p) => !p.configured)
              .map((p) => p.id)
              .join(", ")}{" "}
            — add the client id/secret env vars and the connect buttons will appear.
          </p>
        </div>
      ) : null}
    </div>
  );
}