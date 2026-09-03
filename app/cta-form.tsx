"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRight, ShieldCheck } from "lucide-react";

const WHATSAPP_NUMBER = "9019977375";

const fieldClasses =
  "mt-2 w-full border-0 border-b border-black/20 rounded-none shadow-none focus-visible:ring-0 focus-visible:border-[#25D366] bg-transparent px-0 py-3 text-sm h-10";

export function CtaForm() {
  const [businessName, setBusinessName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = businessName.trim();
    const number = whatsapp.trim();
    const type = businessType || "business";
    const text = [
      `Hi WhataAI — I'd like to get set up on WhatsApp. Here are my details.`,
      name ? `Business name: ${name}` : "",
      type === "business" ? "" : `Business type: ${type}`,
      number ? `My WhatsApp: ${number}` : "",
      email ? `Email: ${email}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    window.open(
      `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl bg-white p-8 text-center">
        <ShieldCheck className="mb-3 size-10 text-[#25D366]" />
        <p className="text-lg font-bold text-black">One last step</p>
        <p className="mt-2 max-w-sm text-sm leading-6 text-black/60">
          WhatsApp just opened with your details pre-filled. Tap{" "}
          <span className="font-semibold text-black">Send</span> and
          we&apos;ll get back to you. Didn&apos;t open?{" "}
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#25D366] underline"
          >
            Message us directly
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-5 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold text-black">
          Business name
          <Input
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Your business"
            className={fieldClasses}
          />
        </label>
        <label className="text-xs font-bold text-black">
          WhatsApp number
          <Input
            required
            type="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="+1 555 000 0000"
            className={fieldClasses}
          />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-bold text-black">
          Business type
          <div className="mt-2">
            <Select value={businessType} onValueChange={setBusinessType} required>
              <SelectTrigger className="w-full border-0 border-b border-black/20 rounded-none shadow-none focus:ring-0 focus:border-[#25D366] bg-white px-0 py-3 text-sm h-10">
                <SelectValue placeholder="Select one" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shop">Shop</SelectItem>
                <SelectItem value="clinic">Clinic</SelectItem>
                <SelectItem value="salon">Salon</SelectItem>
                <SelectItem value="restaurant">Restaurant</SelectItem>
                <SelectItem value="service">Service business</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </label>
        <label className="text-xs font-bold text-black">
          Email
          <Input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@business.com"
            className={fieldClasses}
          />
        </label>
      </div>
      <Button
        type="submit"
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-black px-5 py-6 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 hover:bg-black/90"
      >
        Get started on WhatsApp <ArrowRight className="size-4" />
      </Button>
      <p className="flex items-center justify-center gap-1.5 text-center text-[10px] text-black/45">
        <ShieldCheck className="size-3.5" /> We&apos;ll open WhatsApp so you can send us your details — no pressure.
      </p>
    </form>
  );
}
