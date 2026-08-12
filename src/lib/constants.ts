import { Zap, Youtube, ThumbsUp, PlayCircle, Instagram, Music2, Send, MessageCircle, Globe, Download, QrCode, Link2, BarChart3, Activity, Shield } from 'lucide-react';

export const FEATURES = [
  { icon: '💰', iconComp: Zap, title: 'Earn by CPM', desc: 'Get paid for every 1000 valid views from real users worldwide.' },
  { icon: '▶️', iconComp: Youtube, title: 'YouTube Subscribe Unlock', desc: 'Grow your YouTube subscribers through unlock campaigns.' },
  { icon: '👍', iconComp: ThumbsUp, title: 'YouTube Like Unlock', desc: 'Send visitors to your configured YouTube task URL as part of an unlock campaign.' },
  { icon: '🎬', iconComp: PlayCircle, title: 'Watch Video Unlock', desc: 'Increase watch time and views on your video content.' },
  { icon: '📷', iconComp: Instagram, title: 'Instagram Follow Unlock', desc: 'Use your exact Instagram URL as an unlock task.' },
  { icon: '🎵', iconComp: Music2, title: 'TikTok Follow Unlock', desc: 'Direct visitors to the TikTok URL you configure.' },
  { icon: '✈️', iconComp: Send, title: 'Telegram Join Unlock', desc: 'Grow your Telegram channels and groups quickly.' },
  { icon: '💬', iconComp: MessageCircle, title: 'Discord Join Unlock', desc: 'Expand your Discord community with active members.' },
  { icon: '🌐', iconComp: Globe, title: 'Website Visit Unlock', desc: 'Drive real, targeted traffic to your website.' },
  { icon: '📁', iconComp: Download, title: 'File Download Unlock', desc: 'Get downloads for your files, eBooks, and resources.' },
  { icon: '📱', iconComp: QrCode, title: 'QR Code Generator', desc: 'Create QR codes for your campaigns instantly.' },
  { icon: '🔗', iconComp: Link2, title: 'Campaign Short Links', desc: 'Every campaign gets a short shareable /c/ link.' },
  { icon: '📊', iconComp: BarChart3, title: 'Analytics Dashboard', desc: 'Track views, valid rate, countries and earnings from real data.' },
  { icon: '⚡', iconComp: Activity, title: 'Earnings Dashboard', desc: 'Watch your earnings, pending balance and withdrawals as they update.' },
  { icon: '🛡️', iconComp: Shield, title: 'Server-Side Fraud Detection', desc: 'Automated checks filter bots, VPNs and fake traffic before views pay.' },
];

export const STEPS = [
  { n: 1, title: 'Create Campaign', desc: 'Set up your unlock campaign in minutes', icon: '✨' },
  { n: 2, title: 'Share Your Link', desc: 'Share your unique campaign link anywhere', icon: '🔗' },
  { n: 3, title: 'Audience Completes Tasks', desc: 'Visitors complete tasks to unlock content', icon: '✅' },
  { n: 4, title: 'Valid Views Count', desc: 'Our servers verify each view for authenticity', icon: '🤖' },
  { n: 5, title: 'Earn Money', desc: 'Get paid for every 1000 valid views', icon: '💰' },
];

export const WHY = [
  { icon: '💎', title: 'Competitive CPM', desc: 'Up to $6 per 1000 valid views in Tier 1 countries (admin-configurable)' },
  { icon: '⚡', title: 'Fast Withdrawals', desc: 'Multiple methods with transparent fees' },
  { icon: '🤖', title: 'Fraud Detection', desc: 'Server-side verification of every view' },
  { icon: '🔒', title: 'Secure Platform', desc: 'Row-level security, email verification and encrypted sessions' },
  { icon: '🌍', title: 'Global Traffic', desc: 'Country-based CPM tiers for markets worldwide' },
  { icon: '📈', title: 'Real Analytics', desc: 'Every view, country and earning tracked from real data' },
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
  { name: 'Sarah K.', role: 'YouTube Creator', text: 'CreatorBoost changed how I monetize my audience. The unlock campaigns are simple to set up and the dashboard is clear about what I earn and why.', avatar: 'S' },
  { name: 'Mike T.', role: 'Instagram Influencer', text: 'I like that every view is verified on the server before it counts. My engagement numbers feel solid and I can see the valid-rate breakdown.', avatar: 'M' },
  { name: 'Priya R.', role: 'TikTok Creator', text: 'The dashboard is easy to use and withdrawals are straightforward. I can track exactly where my traffic comes from.', avatar: 'P' },
];

export const PLATFORMS = ['YouTube', 'Instagram', 'TikTok', 'Telegram', 'Discord', 'Facebook', 'Spotify', 'Twitch'];

export const FAQS = [
  { q: 'How much can I earn?', a: 'Earnings depend on valid views and country tier. Tier 1 countries pay $4-6 per 1000 valid views, Tier 2: $2-3.5, Tier 3: $0.5-1.5. Rates are fully configurable by admin and read from the database for every view.' },
  { q: 'When can I withdraw?', a: 'You can withdraw once your balance reaches the configured minimum. Withdrawals are processed within 24-48 hours via JazzCash, EasyPaisa, PayPal, Binance Pay, USDT, or Bank Transfer.' },
  { q: 'How does fraud detection work?', a: 'Traffic is verified on our servers: automated checks screen user agents, request frequency, VPN/proxy signals and device behavior before a view is counted as valid.' },
  { q: 'What payment methods are supported?', a: 'We support JazzCash, EasyPaisa, PayPal, Binance Pay, USDT (TRC20), and Bank Transfer. The admin can enable/disable any method from the dashboard.' },
  { q: 'How do I increase my CPM rate?', a: 'Level up! Higher creator levels (Bronze → Diamond) unlock progressively higher CPM multipliers and additional perks. Reach Diamond for a 2.0x CPM multiplier.' },
  { q: 'Is CreatorBoost free to use?', a: 'Yes! Creating an account and starting your first campaign is completely free. We only earn when you earn.' },
];
