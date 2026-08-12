'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Gift, Lock, Shield, Sparkles, Unlock } from 'lucide-react';

type DestinationCampaign = {
  name: string;
  description?: string | null;
  banner_url?: string | null;
  thumbnail_url?: string | null;
  destination_url: string;
};

export default function DestinationClient({ campaign }: { campaign: DestinationCampaign }) {
  const [opening, setOpening] = useState(false);

  const openDestination = () => {
    setOpening(true);
    // destination_url was validated when the campaign was saved and is only
    // sent to this component after the server verified the unlock cookie.
    window.setTimeout(() => window.location.assign(campaign.destination_url), 500);
  };

  return (
    <main className="min-h-screen hero-gradient relative overflow-hidden">
      <div className="grid-bg absolute inset-0 -z-10" aria-hidden="true" />
      <div className="floating-orb w-[26rem] h-[26rem] bg-purple-600/30 -top-32 -left-32 animate-float" aria-hidden="true" />
      <div className="floating-orb w-[28rem] h-[28rem] bg-blue-600/30 -bottom-40 -right-40 animate-float" style={{ animationDelay: '-3s' }} aria-hidden="true" />
      <div className="relative max-w-4xl mx-auto px-4 py-8 sm:py-12">
        <div className="text-center mb-6"><Link href="/" className="inline-flex items-center gap-2 group"><span className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/30 group-hover:scale-110 transition"><Unlock className="w-5 h-5 text-white" /></span><span className="font-display text-2xl font-bold">Creator<span className="gradient-text">Boost</span></span></Link></div>
        <div className="glass-strong rounded-2xl overflow-hidden card-glow shadow-2xl">
          {campaign.banner_url ? <div className="relative h-44 sm:h-56 bg-gradient-to-br from-purple-900/30 to-blue-900/30"><img src={campaign.banner_url} alt="" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-[#0a0716] via-transparent to-transparent" /></div> : <div className="h-32 sm:h-40 bg-gradient-to-br from-purple-900/40 to-blue-900/40" />}
          <div className="p-6 sm:p-8 text-center">
            {campaign.thumbnail_url && <div className="relative -mt-16 sm:-mt-20 mb-4 inline-block"><img src={campaign.thumbnail_url} alt="" className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover border-4 border-[#0a0716] shadow-xl" /></div>}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/15 border border-green-500/40 text-green-300 text-xs font-semibold mb-3"><CheckCircle2 className="w-3.5 h-3.5" /> Destination unlocked</div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold mb-2"><Gift className="inline w-6 h-6 sm:w-7 sm:h-7 text-purple-400 mr-1" />{campaign.name}</h1>
            {campaign.description && <p className="text-sm text-gray-400 max-w-xl mx-auto mb-6">{campaign.description}</p>}
            <div className="relative w-full max-w-2xl mx-auto mb-6 rounded-2xl overflow-hidden border border-white/10 bg-gradient-to-br from-purple-900/20 to-blue-900/20 min-h-[220px]"><div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6"><span className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center mb-3"><Sparkles className="w-6 h-6 text-purple-300" /></span><p className="text-sm font-semibold text-gray-200">Your destination is ready</p><p className="text-xs text-gray-400 mt-1">Open it when you are ready to continue.</p><div className="mt-4 flex items-center gap-2 text-[10px] text-gray-500"><Shield className="w-3 h-3" /><span>Unlock access expires shortly for your privacy</span></div></div></div>
            <button onClick={openDestination} disabled={opening} className="btn-primary w-full sm:w-auto sm:min-w-[300px] py-4 rounded-xl text-base font-bold text-white inline-flex items-center justify-center gap-2 disabled:opacity-70">{opening ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Opening destination…</> : <><Gift className="w-5 h-5" /> Open destination <ArrowRight className="w-5 h-5" /></>}</button>
            <p className="text-[11px] text-gray-500 mt-3">You will be redirected to the creator&apos;s configured URL.</p>
          </div>
        </div>
        <p className="text-center text-xs text-gray-500 mt-4">Powered by <Link href="/" className="text-purple-400 hover:text-purple-300">CreatorBoost</Link></p>
      </div>
    </main>
  );
}
