"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Plug, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function OAuthResultCard() {
  const params = useSearchParams();
  const success = params.get("success") === "1";
  const name = params.get("name");
  const tenantId = params.get("tenantId");
  const error = params.get("error");

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {success ? (
              <CheckCircle2 className="size-5 text-emerald-600" />
            ) : (
              <XCircle className="size-5 text-destructive" />
            )}
            {success ? "Connected" : "Connection failed"}
          </CardTitle>
          <CardDescription>
            {success
              ? name
                ? `Your integration “${name}” is connected and ready to use in automations.`
                : "Your integration is connected and ready to use."
              : error
                ? error
                : "The OAuth handshake did not complete. Close this window and try again."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {tenantId ? (
            <Button asChild>
              <Link href="/dashboard/automations/integrations">
                <Plug className="size-4" />
                Go to integrations
              </Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href="/dashboard/automations">Go to automations</Link>
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/dashboard/automations">Back to automations</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function OAuthResultPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
          Finalising connection…
        </div>
      }
    >
      <OAuthResultCard />
    </Suspense>
  );
}