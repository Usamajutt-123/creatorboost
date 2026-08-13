import Image from 'next/image';
import {
  BadgeDollarSign,
  Code2,
  MapPin,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

const highlights = [
  { label: 'Founder & Developer', icon: Sparkles },
  { label: 'Creator Growth', icon: TrendingUp },
  { label: 'Monetization', icon: BadgeDollarSign },
  { label: 'Software Development', icon: Code2 },
];

export default function AboutBuilder() {
  return (
    <section className="mb-12" aria-labelledby="builder-heading">
      <header className="mb-7 max-w-3xl sm:mb-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
          THE BUILDER
        </p>
        <h2
          id="builder-heading"
          className="font-display text-3xl font-bold leading-tight text-white sm:text-4xl"
        >
          Built by a creator who understands the journey.
        </h2>
      </header>

      <article className="glass-strong relative isolate overflow-hidden rounded-3xl p-5 shadow-[0_24px_70px_-36px_rgba(99,102,241,0.65)] sm:p-7 lg:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-24 -z-10 h-64 w-64 rounded-full bg-purple-500/15 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-28 left-1/3 -z-10 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl"
          aria-hidden="true"
        />

        <div className="grid items-center gap-7 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-10">
          <div className="relative mx-auto aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-bg-700 shadow-[0_18px_50px_-22px_rgba(34,211,238,0.35)] lg:max-w-none">
            <Image
              src="/images/usama-mukhtar.webp"
              alt="Usama Mukhtar — Founder and Software Developer of CreatorBoost"
              fill
              sizes="(max-width: 639px) calc(100vw - 72px), (max-width: 1023px) 384px, 380px"
              className="object-cover object-center"
            />
            <div
              className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10"
              aria-hidden="true"
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-purple-300">
              Founder &amp; Software Developer
            </p>
            <h3 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              USAMA MUKHTAR
            </h3>
            <p className="mt-2 text-sm font-medium text-gray-300 sm:text-base">
              Software Developer &amp; Creator Growth Builder
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-gray-400">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                <MapPin className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
                Rahim Yar Khan, Punjab, Pakistan
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                20 years old
              </span>
            </div>

            <p className="mt-6 leading-relaxed text-gray-300">
              20-year-old software developer building CreatorBoost and helping creators grow
              their channels, understand monetization, and earn more from their audience.
            </p>

            <div className="mt-6 border-t border-white/10 pt-6">
              <h4 className="font-display text-lg font-semibold text-white">
                Why I built CreatorBoost
              </h4>
              <p className="mt-3 text-sm leading-7 text-gray-400 sm:text-base">
                I built CreatorBoost myself with the goal of helping creators turn their
                audience into sustainable earnings. I work across the product, development,
                monetization systems, and platform improvements myself. My focus is simple:
                build useful tools that help creators grow and make better money from their
                content.
              </p>
              <p className="mt-4 text-sm font-medium text-gray-300">
                Founder &amp; Developer — I built and manage the platform myself.
              </p>
            </div>

            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Areas of focus">
              {highlights.map(({ label, icon: Icon }) => (
                <li
                  key={label}
                  className="inline-flex items-center gap-2 rounded-lg border border-purple-400/20 bg-purple-500/[0.08] px-3 py-2 text-xs font-medium text-gray-200"
                >
                  <Icon className="h-3.5 w-3.5 text-purple-300" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </article>
    </section>
  );
}
