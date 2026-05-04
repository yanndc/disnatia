"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RefreshQuotesButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onRefresh() {
    setPending(true);
    try {
      const response = await fetch("/api/portfolio/refresh-quotes", {
        method: "POST",
      });
      if (response.ok) {
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className="h-9 px-3 text-sm"
      disabled={pending}
      onClick={() => void onRefresh()}
    >
      {pending ? "Mise à jour…" : "Actualiser les cours"}
    </Button>
  );
}
