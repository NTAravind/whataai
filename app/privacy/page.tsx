export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 text-zinc-800 dark:bg-black dark:text-zinc-200">
      <div className="mx-auto max-w-3xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-4 text-base leading-7">
          This project is built to support WhatsApp-based communication and therefore follows the privacy principles and practices described in the WhatsApp privacy policy, as well as applicable data protection requirements.
        </p>

        <h2 className="mt-8 text-xl font-semibold">What this means</h2>
        <p className="mt-3 text-base leading-7">
          We aim to handle user information responsibly, limit data collection to what is necessary for the service to function, and use secure systems when processing messages, account information, or related operational data.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Data handled through WhatsApp</h2>
        <p className="mt-3 text-base leading-7">
          When this project is used with WhatsApp, the handling of data is guided by WhatsApp&apos;s platform policies and Meta&apos;s related privacy standards. This includes respecting user consent, protecting message-related information, and using data only for the purpose of providing the intended service.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Your choices</h2>
        <p className="mt-3 text-base leading-7">
          You may choose whether to use WhatsApp-based features and can review WhatsApp&apos;s own privacy settings and controls for additional information about how your data is managed within the WhatsApp platform.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Contact</h2>
        <p className="mt-3 text-base leading-7">
          If you have questions about this privacy page or how this project uses information in connection with WhatsApp, please contact the project maintainer.
        </p>
      </div>
    </main>
  );
}
