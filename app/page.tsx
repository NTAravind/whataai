import {
  ArrowRight,
  CalendarCheck,
  Check,
  ChevronDown,
  Clock3,
  Coffee,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Scissors,
  Send,
  ShoppingBag,
  Sparkles,
  Store,
  Stethoscope,
  X,
  Zap,
} from "lucide-react";
import { CtaForm } from "./cta-form";

const WHATSAPP_NUMBER = "9019977375";
const product = "WhataAI";

const content = {
  nav: ["How it works", "Features", "Pricing", "FAQ"],
  motto: ["Answer", "Sell", "Book", "Grow"],
  faqs: [
    ["Do I need to know how to code?", "No. We set it up with you in plain language. You share your price list, services, and common questions, and that's it."],
    ["Will this replace my current WhatsApp number?", `No. ${product} works with your business WhatsApp number, so your customers keep chatting on the number they already have saved.`],
    [`What if ${product} doesn't know the answer?`, "It says so, and hands the conversation to you. You stay in control of anything that needs a personal answer."],
    ["Can I take a conversation back at any time?", `Yes, any time. ${product} handles the everyday questions and clears your inbox; you step in whenever you want to.`],
    ["How long does setup take?", "Most businesses are live within minutes. We help you connect your number and load in the information your assistant needs."],
    ["Do my customers need to install anything?", "No. It all happens inside the WhatsApp chat they already use every day."],
  ],
};

const ArrowLink = ({ children, href = "#start" }: { children: React.ReactNode; href?: string }) => (
  <a href={href} className="inline-flex items-center gap-2 text-sm font-semibold transition-colors hover:text-[#25D366]">
    {children} <ArrowRight className="size-4" />
  </a>
);

function ChatMock({ variant = "booking" }: { variant?: "booking" | "sales" | "support" }) {
  const messages = {
    booking: [
      ["Hi! Do you have a haircut slot this Friday?", "10:41"],
      ["I do. I can book you with Maya at 3:30 PM. Want me to save it?", "10:41"],
      ["Yes please!", "10:42"],
    ],
    sales: [
      ["I need something for dry skin.", "14:08"],
      ["Our Daily Glow set is a great fit — $32, includes cleanser, cream, and SPF.", "14:08"],
      ["That sounds perfect. Add it to my order.", "14:09"],
    ],
    support: [
      ["Are you open on Sundays?", "08:12"],
      ["Yes, 10 AM–4 PM this Sunday. Want me to reserve a table too?", "08:12"],
      ["Great, book for two at 12:30.", "08:13"],
    ],
  }[variant];

  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[22px] border border-black/10 bg-[#efeae2] shadow-[0_24px_60px_rgba(0,0,0,0.14)]">
      <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
        <img src="/logo.svg" alt="WhataAI logo" className="size-9 rounded-full bg-white" />
        <div className="flex-1">
          <p className="text-sm font-semibold">{product} assistant</p>
          <p className="text-[10px] text-white/70">online</p>
        </div>
        <Phone className="size-4" /><MoreHorizontal className="size-5" />
      </div>
      <div className="space-y-2.5 bg-[radial-gradient(#d4cfc4_0.8px,transparent_0.8px)] bg-[size:12px_12px] p-3.5">
        <div className="mx-auto w-fit rounded-md bg-[#f7df9e] px-2 py-1 text-[9px] text-[#725f35]">TODAY</div>
        {messages.map(([message, time], index) => (
          <div key={message} className={`flex ${index % 2 === 0 ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-4 shadow-sm ${index % 2 === 0 ? "rounded-tl-none bg-white text-[#303030]" : "rounded-tr-none bg-[#d9fdd3] text-[#303030]"}`}>
              {message}
              <span className="ml-2 whitespace-nowrap text-[9px] text-gray-400">
                {time} {index % 2 === 1 && <span className="text-[#53bdeb]">✓✓</span>}
              </span>
            </div>
          </div>
        ))}
        {variant === "booking" && (
          <div className="ml-auto flex max-w-[85%] items-center gap-2 rounded-lg bg-[#25D366] px-3 py-2 text-[11px] font-semibold text-black">
            <CalendarCheck className="size-4" /> Booking confirmed
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-black/5 bg-[#f0f2f5] px-3 py-2.5 text-gray-400">
        <span className="flex-1 rounded-full bg-white px-3 py-1.5 text-[10px]">Type a message</span>
        <Send className="size-4 text-[#075e54]" />
      </div>
    </div>
  );
}

function Navbar() {
  return (
    <header className="fixed inset-x-4 top-4 z-50 mx-auto w-fit max-w-full rounded-full border border-black/10 bg-[#f7f7f4]/90 backdrop-blur-md shadow-sm">
      <div className="flex items-center gap-6 px-6 py-3 sm:gap-10 sm:px-8">
        <a href="#top" className="flex items-center gap-2">
          <img src="/logo.svg" alt="WhataAI logo" className="size-7" />
        </a>
        <nav className="hidden items-center gap-8 text-xs font-semibold md:flex">
          {content.nav.map((item) => (
            <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`} className="transition-colors hover:text-[#25D366]">
              {item}
            </a>
          ))}
        </nav>
        <a href="#start" className="hidden items-center gap-2 rounded-full bg-black px-5 py-2.5 text-xs font-bold text-white transition-transform hover:-translate-y-0.5 md:flex">
          Request access <ArrowRight className="size-3.5" />
        </a>
        <details className="group relative md:hidden">
          <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-full border border-black/10 [&::-webkit-details-marker]:hidden">
            <Menu className="size-4 group-open:hidden" /><X className="hidden size-4 group-open:block" />
          </summary>
          <nav className="absolute right-0 top-12 w-56 space-y-1 rounded-2xl border border-black/10 bg-white p-3 text-sm font-semibold shadow-xl">
            {content.nav.map((item) => (
              <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`} className="block rounded-lg px-3 py-2.5 hover:bg-[#f1f1ed]">
                {item}
              </a>
            ))}
            <a href="#start" className="mt-2 block rounded-lg bg-black px-3 py-2.5 text-center text-white">Request access</a>
          </nav>
        </details>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="overflow-hidden border-b border-black/10 bg-[#f7f7f4] pt-32 pb-20 lg:pt-36 lg:pb-24">
      <div className="mx-auto grid max-w-7xl gap-14 px-5 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8">
        <div>
          <h1 className="max-w-3xl text-5xl font-black leading-[0.95] tracking-[-0.075em] sm:text-7xl lg:text-[6.6rem]">
            Your WhatsApp, now an employee that <span className="text-[#25D366]">never sleeps.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-black/60 sm:text-lg">
            {product} replies to your customers, sells for you, and books their appointments — automatically, right inside the chat they already have open.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#start" className="inline-flex items-center gap-3 rounded-full bg-[#25D366] px-5 py-3.5 text-sm font-bold text-black transition-transform hover:-translate-y-0.5">
              Request access <ArrowRight className="size-4" />
            </a>
            <a href="#how-it-works" className="inline-flex items-center gap-2 rounded-full border border-black/15 px-5 py-3.5 text-sm font-bold transition-colors hover:bg-black hover:text-white">
              See how it works
            </a>
          </div>
          <div className="mt-12 flex flex-wrap gap-x-10 gap-y-4 text-sm">
            <div>
              <p className="text-2xl font-black tracking-[-0.03em]">&lt; 10 min</p>
              <p className="mt-0.5 text-black/50">From signup to your first automated reply</p>
            </div>
            <div>
              <p className="text-2xl font-black tracking-[-0.03em]">24/7</p>
              <p className="mt-0.5 text-black/50">Answering, selling, and booking while you're off the clock</p>
            </div>
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-12 bg-[radial-gradient(circle_at_center,rgba(37,211,102,0.16),transparent_62%)]" />
          <div className="relative">
            <div className="mb-4 ml-auto flex w-fit items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-[10px] font-semibold shadow-sm">
              <span className="size-2 rounded-full bg-[#25D366]" /> Always on, always helpful
            </div>
            <ChatMock />
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  return (
    <section className="border-b border-black/10 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-7 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <p className="max-w-xs text-sm font-semibold leading-5">Built for businesses that run on conversations.</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-[11px] font-bold uppercase tracking-[0.1em] text-black/45 sm:flex sm:gap-7">
          <span className="flex items-center gap-2"><Store className="size-4" /> Shops</span>
          <span className="flex items-center gap-2"><Stethoscope className="size-4" /> Clinics</span>
          <span className="flex items-center gap-2"><Scissors className="size-4" /> Salons</span>
          <span className="flex items-center gap-2"><Coffee className="size-4" /> Restaurants</span>
        </div>
      </div>
    </section>
  );
}

function BeforeAfter() {
  const before = [
    "Messages sit unread for hours between customers",
    "A missed call means a missed booking",
    "Every question, big or small, needs your personal reply",
    "Follow-ups get forgotten once the chat scrolls away",
  ];
  const after = [
    "Every message gets an answer in seconds, day or night",
    "Customers book their own slot without waiting on you",
    "Routine questions are handled; only the tricky ones reach you",
    "Follow-ups go out on their own, so fewer leads go cold",
  ];
  return (
    <section className="border-b border-black/10 bg-[#f7f7f4] py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mb-14 max-w-2xl">
          <h2 className="text-4xl font-black leading-[0.98] tracking-[-0.06em] sm:text-6xl">What running WhatsApp support looks like, before and after.</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-black/10 bg-white p-8">
            <p className="mb-6 text-xs font-bold uppercase tracking-[0.14em] text-black/40">Without {product}</p>
            <ul className="space-y-4">
              {before.map((line) => (
                <li key={line} className="flex items-start gap-3 text-sm leading-6 text-black/65">
                  <X className="mt-0.5 size-4 shrink-0 text-black/30" /> {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-[#25D366] bg-white p-8 shadow-[0_16px_40px_rgba(37,211,102,0.12)]">
            <p className="mb-6 text-xs font-bold uppercase tracking-[0.14em] text-[#0f8a52]">With {product}</p>
            <ul className="space-y-4">
              {after.map((line) => (
                <li key={line} className="flex items-start gap-3 text-sm font-medium leading-6">
                  <Check className="mt-0.5 size-4 shrink-0 text-[#25D366]" /> {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ["01", "Connect your WhatsApp number", "Takes minutes. No coding, no new number for your customers to learn."],
    ["02", "Tell it about your business", "Share your price list, services, opening hours, or FAQs. It learns what matters."],
    ["03", "Let it take over the conversation", "It answers, sells, books, and follows up while you focus on the work in front of you."],
  ];
  return (
    <section id="how-it-works" className="border-b border-black/10 bg-white py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mb-14 max-w-2xl">
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.14em] text-black/40">How it works</p>
          <h2 className="text-4xl font-black leading-[0.98] tracking-[-0.06em] sm:text-6xl">From first message to happy customer, in three steps.</h2>
        </div>
        <div className="grid gap-10 md:grid-cols-3">
          {steps.map(([number, title, text]) => (
            <div key={number} className="border-t-2 border-black pt-5">
              <div className="mb-12 flex items-center justify-between">
                <span className="text-3xl font-black tracking-[-0.06em] text-black/20">{number}</span>
                <Zap className="size-5 text-[#25D366]" />
              </div>
              <h3 className="max-w-xs text-xl font-bold tracking-[-0.03em]">{title}</h3>
              <p className="mt-3 max-w-xs text-sm leading-6 text-black/55">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pillars() {
  const secondary = [
    ["Sell", "Your best salesperson on autopilot.", "Recommend the right product or service and guide customers toward a purchase.", ShoppingBag],
    ["Book", "No more back-and-forth.", "Handle appointments, orders, and bookings directly in the chat. Never miss a slot.", CalendarCheck],
    ["Grow", "Keep the conversation going.", "Follow up with customers, bring back lost leads, and see what is working.", Sparkles],
  ] as const;
  return (
    <section id="features" className="border-b border-black/10 bg-[#f7f7f4] py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mb-14 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <h2 className="max-w-2xl text-4xl font-black leading-[0.98] tracking-[-0.06em] sm:text-6xl">One assistant. Four ways to move your business forward.</h2>
          <p className="max-w-xs text-sm leading-6 text-black/55">Everything happens in the WhatsApp chat your customers already use.</p>
        </div>
        <div className="grid gap-4">
          <div className="grid gap-px overflow-hidden rounded-2xl border border-black/10 bg-black/10 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col justify-between bg-black p-8 text-white sm:p-10">
              <div className="flex items-center justify-between">
                <MessageCircle className="size-7 text-[#25D366]" />
                <span className="rounded-full border border-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Answer</span>
              </div>
              <div className="mt-16">
                <h3 className="text-3xl font-black tracking-[-0.045em] sm:text-4xl">Instant replies, day or night.</h3>
                <p className="mt-3 max-w-md text-sm leading-6 text-white/55">Answer customer questions in your own voice, even when you're busy, closed, or asleep.</p>
                <div className="mt-6"><ArrowLink href="#start">See it in action</ArrowLink></div>
              </div>
            </div>
            <div className="flex items-center justify-center bg-white p-8 sm:p-10">
              <ChatMock variant="support" />
            </div>
          </div>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-black/10 bg-black/10 sm:grid-cols-3">
            {secondary.map(([name, title, text, Icon]) => (
              <div key={name} className="bg-white p-6 sm:p-8">
                <div className="mb-14 flex items-center justify-between">
                  <Icon className="size-6 text-[#25D366]" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-black/35">{name}</span>
                </div>
                <h3 className="text-xl font-black tracking-[-0.04em]">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-black/55">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureDeepDive() {
  const features = [
    ["Turns chats into sales", "It understands what customers are looking for and points them to the right products or services, without pushing a hard sell.", "sales"],
    ["Bookings without the phone tag", "Customers pick a time, place an order, or make a booking without waiting for you to pick up the phone.", "booking"],
  ] as const;
  return (
    <section className="border-b border-black/10 bg-white py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="space-y-20 lg:space-y-28">
          {features.map(([title, text, variant], index) => (
            <div key={title} className={`grid items-center gap-12 lg:grid-cols-2 lg:gap-24 ${index % 2 === 1 ? "lg:[&>div:first-child]:order-2" : ""}`}>
              <div>
                <h2 className="max-w-lg text-4xl font-black leading-[0.98] tracking-[-0.06em] sm:text-5xl">{title}</h2>
                <p className="mt-4 max-w-md text-sm leading-6 text-black/55">{text}</p>
                <div className="mt-7"><ArrowLink>Learn more</ArrowLink></div>
              </div>
              <ChatMock variant={variant} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyWhataAI() {
  const benefits = [
    ["No app to download", "Your customers already know WhatsApp. They just send a message.", MessageCircle],
    ["No tech skills needed", "Set up your assistant with the same words you use to run your business.", Sparkles],
    ["Works while you sleep", "Keep serving customers at midnight, on weekends, and during the rush.", Clock3],
  ] as const;
  return (
    <section className="border-b border-black/10 bg-black py-24 text-white lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <h2 className="max-w-2xl text-4xl font-black leading-[0.98] tracking-[-0.06em] sm:text-6xl">Why businesses choose {product}.</h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/15 md:grid-cols-3">
          {benefits.map(([title, text, Icon]) => (
            <div key={title} className="bg-black p-6 sm:p-8">
              <Icon className="size-6 text-[#25D366]" />
              <h3 className="mt-16 text-2xl font-black tracking-[-0.04em]">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-white/55">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="border-b border-black/10 bg-[#f7f7f4] py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mb-14 max-w-2xl">
          <h2 className="text-4xl font-black leading-[0.98] tracking-[-0.06em] sm:text-6xl">Pricing that grows with you.</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col rounded-2xl border border-black/10 bg-white/60 p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-[#25D366] text-black"><Zap className="size-5" /></div>
              <div>
                <h3 className="text-xl font-black tracking-[-0.04em]">Plans that fit your business.</h3>
                <p className="text-sm text-black/55">From a single assistant to a full automation setup.</p>
              </div>
            </div>
            <ul className="mt-6 flex-1 space-y-3 text-sm">
              {["Connect your own WhatsApp number(s)", "AI agents answering, selling, and booking", "Knowledge base, templates, and flows", "Usage tracking and monthly budgets", "Multi-channel: WhatsApp and email"].map((feature) => (
                <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#25D366]" />{feature}</li>
              ))}
            </ul>
            <a href="#start" className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-black px-4 py-3 text-sm font-bold text-white">
              Get a demo <ArrowRight className="size-4" />
            </a>
          </div>
          <div className="flex flex-col rounded-2xl border border-[#25D366] bg-white p-6 shadow-[0_12px_30px_rgba(37,211,102,0.12)] sm:p-8">
            <span className="mb-4 w-fit rounded-full bg-[#25D366] px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-black">Let's talk</span>
            <h3 className="text-xl font-black tracking-[-0.04em]">Custom setup, human support</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-black/55">Plans are tailored to your business — tell us what you need and we'll recommend a fit. No public price card: every setup is scoped to your numbers, agents, and volume.</p>
            <ul className="mt-6 flex-1 space-y-3 text-sm">
              {["Free onboarding and configuration", "We connect your number for you", "Priority support during setup", "Scales from one to many WhatsApp numbers"].map((feature) => (
                <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#25D366]" />{feature}</li>
              ))}
            </ul>
            <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-bold text-black">
              Request pricing <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section id="faq" className="border-b border-black/10 bg-white py-24 lg:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[0.7fr_1.3fr] lg:px-8">
        <div>
          <h2 className="max-w-sm text-4xl font-black leading-[0.98] tracking-[-0.06em] sm:text-5xl">Plain answers for real businesses.</h2>
        </div>
        <div className="divide-y divide-black/10 border-t border-black">
          {content.faqs.map(([question, answer]) => (
            <details key={question} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-bold tracking-[-0.02em] [&::-webkit-details-marker]:hidden">
                {question}
                <ChevronDown className="size-5 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <p className="max-w-2xl pt-3 pr-8 text-sm leading-6 text-black/55">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section id="start" className="bg-[#25D366] py-24 lg:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8">
        <div>
          <h2 className="max-w-xl text-5xl font-black leading-[0.93] tracking-[-0.07em] sm:text-7xl">
            Answer. Sell. Book. <span className="text-white">Grow.</span>
          </h2>
          <p className="mt-6 max-w-md text-base leading-6 text-black/65">Tell us about your business and we'll help you get your assistant up and running.</p>
          <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4">
            Prefer to talk? Message us on WhatsApp <ArrowRight className="size-4" />
          </a>
        </div>
        <CtaForm />
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-black py-10 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 lg:px-8">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div>
            <a href="#top" className="flex items-center gap-2">
              <img src="/logo.svg" alt="WhataAI logo" className="size-7" />
              <span className="text-xl font-black tracking-[-0.07em]">Whata<span className="text-[#25D366]">AI</span><span className="text-[#25D366]">.</span></span>
            </a>
            <p className="mt-3 text-xs text-white/45">Answer. Sell. Book. Grow.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-white/60">
            {content.nav.map((item) => (
              <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`} className="hover:text-[#25D366]">{item}</a>
            ))}
            <a href={`https://wa.me/${WHATSAPP_NUMBER}`} className="hover:text-[#25D366]">Contact</a>
          </nav>
        </div>
        <div className="flex flex-col justify-between gap-3 border-t border-white/15 pt-5 text-[10px] text-white/35 sm:flex-row">
          <span>© 2026 {product}. All rights reserved.</span>
          <span><a href="https://infiniio.tech" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-white">Product by infini</a></span>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <main className="overflow-hidden bg-[#f7f7f4] text-[#111]">
      <Navbar />
      <Hero />
      <TrustStrip />
      <BeforeAfter />
      <HowItWorks />
      <Pillars />
      <FeatureDeepDive />
      <WhyWhataAI />
      <Pricing />
      <FAQ />
      <CTA />
      <Footer />
    </main>
  );
}