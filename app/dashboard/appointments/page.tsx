"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingState } from "@/components/data-state";

export default function AppointmentsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/bookings");
  }, [router]);

  return (
    <div className="p-8">
      <LoadingState rows={4} />
    </div>
  );
}
