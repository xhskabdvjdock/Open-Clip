import { useState } from "react";
import { ClipboardList, Keyboard, ShieldCheck } from "lucide-react";
import { useStore } from "../lib/store";

export default function Onboarding() {
  const { strings: t, settings, updateSettings } = useStore();
  const [step, setStep] = useState(0);

  const done = () => void updateSettings({ onboardingDone: true });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-100 p-4 dark:bg-neutral-900">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
        {step === 0 && (
          <>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900">
              <ClipboardList className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
              {t.welcome}
            </h1>
            <p className="mt-2 text-[14px] leading-6 text-neutral-600 dark:text-neutral-300">
              {t.welcomeBody}
            </p>
            <ul className="mt-4 space-y-2 text-start text-[13px] text-neutral-600 dark:text-neutral-300">
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0" /> {t.onboardingPrivacy}
              </li>
              <li className="flex items-center gap-2">
                <Keyboard className="h-4 w-4 shrink-0" /> {t.onboardingPicker}{" "}
                <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[11.5px] dark:border-neutral-600 dark:bg-neutral-900" dir="ltr">
                  {settings.quickPasteShortcut}
                </kbd>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0" /> {t.onboardingSensitive}
              </li>
            </ul>
            <div className="mt-6 flex gap-2">
              <button
                onClick={done}
                className="flex-1 rounded-lg border border-neutral-300 px-4 py-2 text-[14px] font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                {t.skip}
              </button>
              <button
                onClick={() => setStep(1)}
                className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 text-[14px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
              >
                {t.next}
              </button>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900">
              <Keyboard className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
              {t.welcomeShortcut}
            </h1>
            <p className="mt-2 text-[14px] text-neutral-600 dark:text-neutral-300">
              <kbd className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-1.5 font-mono text-[14px] dark:border-neutral-600 dark:bg-neutral-900" dir="ltr">
                {settings.quickPasteShortcut}
              </kbd>
            </p>
            <p className="mt-2 text-[13px] text-neutral-500 dark:text-neutral-400">
              Search → ↑↓ → Enter
            </p>
            <button
              onClick={done}
              autoFocus
              className="mt-6 w-full rounded-lg bg-neutral-900 px-4 py-2 text-[14px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
            >
              {t.getStarted}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
