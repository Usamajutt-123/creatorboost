'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Gift, Lock, ArrowRight, ExternalLink, Shield, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Unlock, CheckCircle2 } from 'lucide-react';

export default function DestinationPage() {
    const params = useParams<{ campaign: string }>();
    const router = useRouter();
    const [campaign, setCampaign] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [unlocking, setUnlocking] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const load = async () => {
            const slugOrId = params.campaign;
            const supabase = createClient();

            // Try to find by slug first, then by id
            let { data } = await supabase
                .from('campaigns')
                .select('*, creator:profiles(full_name, level, avatar_url)')
                .eq('slug', slugOrId)
                .eq('status', 'active')
                .maybeSingle();

            if (!data) {
                const r = await supabase
                    .from('campaigns')
                    .select('*, creator:profiles(full_name, level, avatar_url)')
                    .eq('id', slugOrId)
                    .eq('status', 'active')
                    .maybeSingle();
                data = r.data;
            }

            if (!data) {
                // Try without status filter in case it's a draft (still let user get to destination)
                const r2 = await supabase
                    .from('campaigns')
                    .select('*, creator:profiles(full_name, level, avatar_url)')
                    .eq('slug', slugOrId)
                    .maybeSingle();
                data = r2.data;
            }

            setCampaign(data);
            setLoading(false);
        };
        load();
    }, [params.campaign]);

    const handleGetLink = () => {
        setUnlocking(true);
        if (campaign?.destination_url) {
            // open in same tab after small visual delay
            setTimeout(() => {
                window.location.href = campaign.destination_url;
            }, 700);
        } else {
            setError('No destination URL configured');
            setUnlocking(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen hero-gradient flex items-center justify-center px-4">
                <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-4 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
                    <p className="text-sm text-gray-400">Loading reward...</p>
                </div>
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="min-h-screen hero-gradient flex items-center justify-center px-4">
                <div className="glass-strong rounded-2xl p-8 text-center max-w-md">
                    <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                        <Lock className="w-7 h-7 text-red-400" />
                    </div>
                    <h2 className="font-display text-xl font-bold mb-2">Reward Not Found</h2>
                    <p className="text-sm text-gray-400 mb-6">This campaign or reward is no longer available.</p>
                    <Link href="/" className="btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold text-white inline-flex items-center gap-2">
                        Back to Home
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen hero-gradient relative overflow-hidden">
            {/* Background */}
            <div className="grid-bg absolute inset-0 -z-10" aria-hidden="true" />
            <div className="floating-orb w-[26rem] h-[26rem] bg-purple-600/30 -top-32 -left-32 animate-float" aria-hidden="true" />
            <div className="floating-orb w-[28rem] h-[28rem] bg-blue-600/30 -bottom-40 -right-40 animate-float" style={{ animationDelay: '-3s' }} aria-hidden="true" />

            <div className="relative max-w-4xl mx-auto px-4 py-8 sm:py-12">
                {/* Logo */}
                <div className="text-center mb-6">
                    <Link href="/" className="inline-flex items-center gap-2 group">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/30 group-hover:scale-110 transition">
                            <Unlock className="w-5 h-5 text-white" />
                        </div>
                        <span className="font-display text-2xl font-bold">Creator<span className="gradient-text">Boost</span></span>
                    </Link>
                </div>

                <div className="glass-strong rounded-2xl overflow-hidden card-glow shadow-2xl">
                    {/* Banner */}
                    {campaign.banner_url ? (
                        <div className="relative h-44 sm:h-56 bg-gradient-to-br from-purple-900/30 to-blue-900/30">
                            <img src={campaign.banner_url} alt={campaign.name} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0716] via-transparent to-transparent" />
                        </div>
                    ) : (
                        <div className="h-32 sm:h-40 bg-gradient-to-br from-purple-900/40 to-blue-900/40" />
                    )}

                    <div className="p-6 sm:p-8 text-center">
                        {/* Thumbnail */}
                        {campaign.thumbnail_url && (
                            <div className="relative -mt-16 sm:-mt-20 mb-4 inline-block">
                                <img src={campaign.thumbnail_url} alt={campaign.name} className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover border-4 border-[#0a0716] shadow-xl" />
                            </div>
                        )}

                        {/* Unlocked badge */}
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/15 border border-green-500/40 text-green-300 text-xs font-semibold mb-3 animate-pulse-glow">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Reward Unlocked
                        </div>

                        <h1 className="font-display text-2xl sm:text-3xl font-bold mb-2">
                            <Gift className="inline w-6 h-6 sm:w-7 sm:h-7 text-purple-400 mr-1" />
                            {campaign.name}
                        </h1>
                        {campaign.description && <p className="text-sm text-gray-400 max-w-xl mx-auto mb-6">{campaign.description}</p>}

                        {/* Embedded ad/video area */}
                        <div className="relative w-full max-w-2xl mx-auto mb-6 rounded-2xl overflow-hidden border border-white/10 bg-gradient-to-br from-purple-900/20 to-blue-900/20" style={{ minHeight: '240px' }}>
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center mb-3">
                                    <Sparkles className="w-6 h-6 text-purple-300" />
                                </div>
                                <p className="text-sm font-semibold text-gray-200">Your reward is ready</p>
                                <p className="text-xs text-gray-400 mt-1">Click the button below to claim it</p>
                                <div className="mt-4 flex items-center gap-2 text-[10px] text-gray-500">
                                    <Shield className="w-3 h-3" />
                                    <span>Sponsored placement</span>
                                </div>
                            </div>
                        </div>

                        {/* Get Link button */}
                        {error ? (
                            <p className="text-sm text-red-400 mb-3">{error}</p>
                        ) : null}
                        <button
                            onClick={handleGetLink}
                            disabled={unlocking}
                            className="btn-primary w-full sm:w-auto sm:min-w-[300px] py-4 rounded-xl text-base font-bold text-white inline-flex items-center justify-center gap-2 disabled:opacity-70"
                        >
                            {unlocking ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Opening reward...
                                </>
                            ) : (
                                <>
                                    <Gift className="w-5 h-5" /> Get Link <ArrowRight className="w-5 h-5" />
                                </>
                            )}
                        </button>
                        <p className="text-[11px] text-gray-500 mt-3">
                            You will be redirected to the creator&apos;s destination
                        </p>
                    </div>
                </div>

                <p className="text-center text-xs text-gray-500 mt-4">
                    Powered by <Link href="/" className="text-purple-400 hover:text-purple-300">CreatorBoost</Link>
                </p>
            </div>
        </div>
    );
}