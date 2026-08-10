import { Zap, Youtube, ThumbsUp, PlayCircle, Instagram, Music2, Send, MessageCircle, Globe, Download, QrCode, Link2, BarChart3, Activity, Shield } from 'lucide-react';

export const FEATURES = [
  { icon: '💰', iconComp: Zap, title: 'Earn by CPM', desc: 'Get paid for every 1000 valid views from real users worldwide.' },
  { icon: '▶️', iconComp: Youtube, title: 'YouTube Subscribe Unlock', desc: 'Grow your YouTube subscribers through unlock campaigns.' },
  { icon: '👍', iconComp: ThumbsUp, title: 'YouTube Like Unlock', desc: 'Boost engagement on your videos with verified likes.' },
  { icon: '🎬', iconComp: PlayCircle, title: 'Watch Video Unlock', desc: 'Increase watch time and views on your video content.' },
  { icon: '📷', iconComp: Instagram, title: 'Instagram Follow Unlock', desc: 'Gain real Instagram followers interested in your content.' },
  { icon: '🎵', iconComp: Music2, title: 'TikTok Follow Unlock', desc: 'Build your TikTok presence with genuine followers.' },
  { icon: '✈️', iconComp: Send, title: 'Telegram Join Unlock', desc: 'Grow your Telegram channels and groups quickly.' },
  { icon: '💬', iconComp: MessageCircle, title: 'Discord Join Unlock', desc: 'Expand your Discord community with active members.' },
  { icon: '🌐', iconComp: Globe, title: 'Website Visit Unlock', desc: 'Drive real, targeted traffic to your website.' },
  { icon: '📁', iconComp: Download, title: 'File Download Unlock', desc: 'Get downloads for your files, eBooks, and resources.' },
  { icon: '📱', iconComp: QrCode, title: 'QR Code Generator', desc: 'Create QR codes for your campaigns instantly.' },
  { icon: '🔗', iconComp: Link2, title: 'URL Shortener', desc: 'Shorten campaign links for cleaner sharing.' },
  { icon: '📊', iconComp: BarChart3, title: 'Analytics Dashboard', desc: 'Track performance with detailed real-time analytics.' },
  { icon: '⚡', iconComp: Activity, title: 'Real-Time Earnings', desc: 'Watch your earnings update in real-time as views come in.' },
  { icon: '🛡️', iconComp: Shield, title: 'AI Fraud Detection', desc: 'Advanced AI filters out bots, VPNs, and fake traffic.' },
];

export const STEPS = [
  { n: 1, title: 'Create Campaign', desc: 'Set up your unlock campaign in minutes', icon: '✨' },
  { n: 2, title: 'Share Your Link', desc: 'Share your unique campaign link anywhere', icon: '🔗' },
  { n: 3, title: 'Audience Completes Tasks', desc: 'Visitors complete tasks to unlock content', icon: '✅' },
  { n: 4, title: 'Valid Views Count', desc: 'AI verifies each view for authenticity', icon: '🤖' },
  { n: 5, title: 'Earn Money', desc: 'Get paid for every 1000 valid views', icon: '💰' },
];

export const WHY = [
  { icon: '💎', title: 'High CPM', desc: 'Up to $6 per 1000 valid views in Tier 1 countries' },
  { icon: '⚡', title: 'Fast Withdrawals', desc: 'Get paid within 24-48 hours via multiple methods' },
  { icon: '🤖', title: 'AI Fraud Detection', desc: 'Industry-leading fraud prevention system' },
  { icon: '🔒', title: 'Secure Platform', desc: 'Bank-grade security with 2FA authentication' },
  { icon: '🌍', title: 'Global Traffic', desc: 'Reach audience from 180+ countries worldwide' },
  { icon: '📈', title: 'Real-Time Analytics', desc: 'Track every view, click, and earning in real-time' },
  { icon: '✨', title: 'Premium Dashboard', desc: 'Beautiful, intuitive interface designed for creators' },
  { icon: '🎯', title: 'Multi Platform Support', desc: 'YouTube, Instagram, TikTok, and more' },
];

export const LEVELS = [
  { name: 'Bronze', level: 'bronze', min: 0, cpm: 0.5, color: 'badge-bronze', icon: '🥉', perks: ['Basic CPM rates', 'Standard support'] },
  { name: 'Silver', level: 'silver', min: 100000, cpm: 1, color: 'badge-silver', icon: '🥈', perks: ['+10% CPM', 'Priority queue'] },
  { name: 'Gold', level: 'gold', min: 1000000, cpm: 2, color: 'badge-gold', icon: '🥇', perks: ['+25% CPM', 'Verified badge', 'Priority support'] },
  { name: 'Platinum', level: 'platinum', min: 5000000, cpm: 3.5, color: 'badge-platinum', icon: '💎', perks: ['+50% CPM', 'Fast withdrawals', 'Premium analytics'] },
  { name: 'Diamond', level: 'diamond', min: 10000000, cpm: 5, color: 'badge-diamond', icon: '👑', perks: ['+100% CPM', 'VIP support', 'Custom features', 'Account manager'] },
];

export const TESTIMONIALS = [
  { name: 'Sarah K.', role: 'YouTube Creator', text: 'CreatorBoost completely changed how I monetize my channel. I went from $200/month to over $2,500 in just 3 months!', avatar: 'S' },
  { name: 'Mike T.', role: 'Instagram Influencer', text: 'The AI fraud detection is incredible. Every view I get is real, which means my engagement is genuine and growing.', avatar: 'M' },
  { name: 'Priya R.', role: 'TikTok Creator', text: 'Best platform for creators, hands down. The dashboard is gorgeous and withdrawals are lightning fast.', avatar: 'P' },
];

export const PLATFORMS = ['YouTube', 'Instagram', 'TikTok', 'Telegram', 'Discord', 'Facebook', 'Spotify', 'Twitch'];

export const FAQS = [
  { q: 'How much can I earn?', a: 'Earnings depend on valid views and country tier. Tier 1 countries pay $4-6 per 1000 valid views, Tier 2: $2-3.5, Tier 3: $0.5-1.5. Rates are fully configurable by admin.' },
  { q: 'When can I withdraw?', a: 'You can withdraw once your balance reaches $10. Withdrawals are processed within 24-48 hours via JazzCash, EasyPaisa, PayPal, Binance Pay, USDT, or Bank Transfer.' },
  { q: 'How does fraud detection work?', a: 'Our AI analyzes 50+ signals including IP reputation, device fingerprinting, behavior patterns, VPN/proxy detection, and more to identify and filter fraudulent traffic.' },
  { q: 'What payment methods are supported?', a: 'We support JazzCash, EasyPaisa, PayPal, Binance Pay, USDT (TRC20), and Bank Transfer. The admin can enable/disable any method from the dashboard.' },
  { q: 'How do I increase my CPM rate?', a: 'Level up! Higher creator levels (Bronze → Diamond) unlock progressively higher CPM rates and additional perks. Reach Diamond for 100% CPM bonus.' },
  { q: 'Is CreatorBoost free to use?', a: 'Yes! Creating an account and starting your first campaign is completely free. We only earn when you earn.' },
];
