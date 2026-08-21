'use client';

/**
 * Client renderer for one monetized shortener step.
 *
 * The server component (/go/[slug]/[step]/page.tsx) validates the session,
 * the step progression and the countdown configuration before this component
 * ever renders. The client only handles presentation and the Continue
 * request — the server re-validates everything on /api/flow/advance.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ExternalLink, Eye, Unlock } from 'lucide-react';
import CountdownContinue from '@/components/monetization/CountdownContinue';
import { MonetizationAds, useGestureAdTrigger } from '@/components/monetization/MonetizationAds';
import type { PublicAdSlot } from '@/lib/monetization/ad-constants';

export type FlowStepContent = {
  position: number;
  title: string;
  subtitle: string | null;
  intro: string | null;
  bodyHtml: string;
  icon: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  countdownSeconds: number;
};

export type FlowCampaign = {
  slug: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  banner_url: string | null;
};

export default function FlowStepClient({
  campaign,
  step,
  content,
  totalSteps,
  ads,
  previewMode,
  finalRedirect,
  progressBar,
  educationalContent,
}: {
  campaign: FlowCampaign;
  step: number;
  content: FlowStepContent;
  totalSteps: number;
  ads: PublicAdSlot[];
  previewMode: boolean;
  finalRedirect: boolean;
  progressBar: boolean;
  educationalContent: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busyLabel, setBusyLabel] = useState('');
  const [revealedDestination, setRevealedDestination] = useState<string | null>(null);
  const fireGestureAds = useGestureAdTrigger(ads);

  const isFinal = step === totalSteps;
  const defaultLabel = isFinal ? 'Continue to destination' : 'Continue';
  const buttonLabel = content.buttonText || defaultLabel;

  const advance = async () => {
    setError('');
    setBusyLabel(isFinal ? 'Preparing your destination…' : 'Continuing…');
    try {
      const response = await fetch('/api/flow/advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.ok) {
        if (data.done && data.destination) {
          if (finalRedirect) {
            window.location.href = data.destination;
          } else {
            setRevealedDestination(data.destination);
          }
          return;
        }
        if (data.next) {
          router.push(data.next);
          return;
        }
      }

      if (data.currentStep && typeof data.currentStep === 'number') {
        // The visitor tried to advance an earlier/other step — take them to
        // the step the session actually allows.
        router.push(`/go/${campaign.slug}/${data.currentStep}`);
        return;
      }

      setError(data.error || 'We could not continue right now. Please try again.');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setBusyLabel('');
    }
  };

  const handleContinue = () => {
    fireGestureAds();
    void advance();
  };

  return (
    <div className="min-h-screen hero-gradient flex items-center justify-center px-4 py-12 relative">
      <div className="blob w-96 h-96 bg-purple-600/30 -top-20 -left-20 animate-float" aria-hidden="true" />
      <div className="blob w-96 h-96 bg-blue-600/30 -bottom-20 -right-20 animate-float" style={{ animationDelay: '-3s' }} aria-hidden="true" />
      <main className="relative w-full max-w-2xl">
        <Link href="/" className="inline-flex items-center gap-2 mb-6" aria-label="CreatorBoost home">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center"><Unlock className="w-6 h-6 text-white" /></span>
          <span className="font-display text-2xl font-bold">Creator<span className="gradient-text">Boost</span></span>
        </Link>

        {previewMode && (
          <div className="mb-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/40 flex items-center gap-2 text-xs sm:text-sm text-amber-200">
            <Eye className="w-4 h-4 flex-shrink-0" />
            <span><strong>Preview mode.</strong> No earnings are generated, no analytics are recorded, and ads are placeholders.</span>
          </div>
        )}

        <div className="glass-strong rounded-2xl overflow-hidden card-glow shadow-2xl">
          {campaign.banner_url && (
            <div className="relative h-32 sm:h-40 bg-gradient-to-br from-purple-900/30 to-blue-900/30 overflow-hidden">
              <img src={campaign.banner_url} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0a0716] via-transparent to-transparent" />
            </div>
          )}

          <div className="p-5 sm:p-7">
            {/* Creator + step header */}
            <div className="flex items-center gap-3 mb-4">
              {campaign.thumbnail_url && (
                <img src={campaign.thumbnail_url} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-white/10" />
              )}
              <div className="min-w-0">
                <p className="text-[11px] text-gray-500 truncate">{campaign.name}</p>
                <p className="text-xs font-semibold text-purple-300">CreatorBoost short link</p>
              </div>
            </div>

            {progressBar && (
              <div className="mb-5" aria-label={`Step ${step} of ${totalSteps}`}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-gray-400">Flow progress</span>
                  <span className="font-semibold text-purple-300">{step} / {totalSteps} ({Math.round((step / totalSteps) * 100)}%)</span>
                </div>
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500" style={{ width: `${(step / totalSteps) * 100}%` }} />
                </div>
              </div>
            )}

            {/* Step header */}
            <div className="flex items-start gap-3 mb-4">
              {content.icon && (
                <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500/30 to-blue-500/30 border border-white/10 flex items-center justify-center text-xl flex-shrink-0" aria-hidden="true">
                  {content.icon}
                </span>
              )}
              <div className="min-w-0">
                <h1 className="font-display text-xl sm:text-2xl font-bold leading-tight">{content.title}</h1>
                {content.subtitle && <p className="text-xs sm:text-sm text-gray-400 mt-1">{content.subtitle}</p>}
              </div>
            </div>

            {content.imageUrl && (
              <div className="mb-4 rounded-xl overflow-hidden border border-white/10">
                <img src={content.imageUrl} alt="" className="w-full object-cover max-h-56" />
              </div>
            )}

            <MonetizationAds slots={ads} position="top" />

            {/* Educational content */}
            {educationalContent && (
              <div className="mt-4">
                {content.intro && <p className="text-sm text-gray-300 leading-relaxed mb-3">{content.intro}</p>}
                {content.bodyHtml ? (
                  <div className="rich-content text-sm text-gray-300" dangerouslySetInnerHTML={{ __html: content.bodyHtml }} />
                ) : null}
              </div>
            )}

            <MonetizationAds slots={ads} position="middle" />

            {/* Revealed destination (final redirect disabled) */}
            {revealedDestination && (
              <div className="mt-5 p-4 rounded-xl bg-green-500/10 border border-green-500/30">
                <p className="text-xs text-green-300 font-semibold mb-2">Your destination is ready</p>
                <p className="text-sm text-green-200 break-all mb-3">{revealedDestination}</p>
                <a
                  href={revealedDestination}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="btn-primary w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"
                >
                  Open destination <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )}

            {!revealedDestination && (
              <CountdownContinue
                seconds={content.countdownSeconds}
                label={buttonLabel}
                stepLabel={`Step ${step} of ${totalSteps}`}
                onContinue={handleContinue}
                busyLabel={busyLabel}
              />
            )}

            {error && (
              <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-2 text-xs text-red-200">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-500 mt-4">
          Powered by <Link href="/" className="text-purple-400 hover:text-purple-300">CreatorBoost</Link> · {step} of {totalSteps}
        </p>
      </main>
    </div>
  );
}
