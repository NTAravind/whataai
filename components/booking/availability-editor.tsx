"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Clock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api/client";
import type { AvailabilityRuleRow, ResourceRow } from "@/lib/api/types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface AvailabilityEditorProps {
  base: string | null;
  businessId: string;
  resources: ResourceRow[];
  rules: AvailabilityRuleRow[];
  timezone: string;
  onChanged: () => void;
}

export function AvailabilityEditor({
  base,
  businessId,
  resources,
  rules,
  timezone,
  onChanged,
}: AvailabilityEditorProps) {
  const [day, setDay] = useState("1");
  const [resourceId, setResourceId] = useState("business");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [adding, setAdding] = useState(false);

  async function createRule() {
    if (!base || !businessId) return;
    setAdding(true);
    try {
      await api(`${base}/availability-rules`, {
        method: "POST",
        body: JSON.stringify({
          businessId,
          resourceId: resourceId === "business" ? null : resourceId,
          dayOfWeek: Number(day),
          startTime: start,
          endTime: end,
          timezone,
        }),
      });
      toast.success("Availability rule added");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add availability rule");
    } finally {
      setAdding(false);
    }
  }

  async function removeRule(ruleId: string) {
    if (!base) return;
    try {
      await api(`${base}/availability-rules/${ruleId}`, { method: "DELETE" });
      toast.success("Availability rule removed");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove rule");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="size-4" />
            Add Working Hours
          </CardTitle>
          <CardDescription>
            Configure weekly recurring available time slots.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Day of Week</Label>
            <Select value={day} onValueChange={setDay}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS.map((label, idx) => (
                  <SelectItem key={label} value={String(idx)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Scope / Resource</Label>
            <Select value={resourceId} onValueChange={setResourceId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="business">Entire Business</SelectItem>
                {resources.map((res) => (
                  <SelectItem key={res.id} value={res.id}>
                    {res.name} ({res.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start-time">Start Time</Label>
              <Input
                id="start-time"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-time">End Time</Label>
              <Input
                id="end-time"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">Timezone: {timezone}</p>

          <Button onClick={createRule} disabled={adding} className="w-full">
            <Plus className="size-4" />
            {adding ? "Adding..." : "Add Time Slot"}
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Weekly Availability Schedule</CardTitle>
          <CardDescription>
            Slots used by the AI engine when checking slot availability.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No availability rules configured yet. Add working hours on the left.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Applies To</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">
                        {DAYS[rule.day_of_week]}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {rule.start_time.slice(0, 5)} – {rule.end_time.slice(0, 5)}
                      </TableCell>
                      <TableCell>
                        {rule.resource?.name ? (
                          <span>{rule.resource.name}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Entire business</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          onClick={() => removeRule(rule.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
