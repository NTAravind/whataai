"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export interface SetupStepStatus {
  hasBusiness: boolean;
  hasResources: boolean;
  hasServices: boolean;
  hasRequirements: boolean;
  hasAvailability: boolean;
  hasAgent: boolean;
}

export function BookingSetupProgress({ status }: { status: SetupStepStatus }) {
  const steps = [
    { label: "Business Details", done: status.hasBusiness, href: "/dashboard/businesses" },
    { label: "Resources", done: status.hasResources, href: "/dashboard/resources", optional: true },
    { label: "Services", done: status.hasServices, href: "/dashboard/services" },
    { label: "Requirements", done: status.hasRequirements, href: "/dashboard/services" },
    { label: "Availability", done: status.hasAvailability, href: "/dashboard/availability" },
    { label: "AI Agent", done: status.hasAgent, href: "/dashboard/agents" },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const pct = Math.round((completedCount / steps.length) * 100);

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-card to-card border-primary/20">
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-base">Booking Engine Setup</h3>
            <p className="text-xs text-muted-foreground">
              Configure your business, services, and requirements to enable WhatsApp AI bookings.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-primary">{pct}% Complete</span>
            <Progress value={pct} className="w-24 h-2" />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-2">
          {steps.map((step, idx) => (
            <Link
              key={idx}
              href={step.href}
              className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs font-medium transition-colors ${
                step.done
                  ? "bg-primary/10 border-primary/30 text-foreground"
                  : "bg-background/60 border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {step.done ? (
                <CheckCircle2 className="size-4 text-primary shrink-0" />
              ) : (
                <Circle className="size-4 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0">
                <p className="truncate">{step.label}</p>
                {step.optional && <p className="text-[10px] text-muted-foreground">Optional</p>}
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
