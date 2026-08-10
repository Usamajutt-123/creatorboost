'use client';
import { useState } from 'react';
import { Link2, QrCode, Shield, Copy } from 'lucide-react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { toast } from 'sonner';
import QRCode from 'qrcode';

export default function ToolsPage() {
  const [url, setUrl] = useState('');
  const [shortResult, setShortResult] = useState('');
  const [qrText, setQrText] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');

  const shortenUrl = async () => {
    if (!url) { toast.error('Enter a URL'); return; }
    const code = Math.random().toString(36).substring(2, 8);
    setShortResult(`cb.io/${code}`);
    toast.success('URL shortened!');
  };

  const generateQR = async () => {
    if (!qrText) { toast.error('Enter text or URL'); return; }
    try {
      const dataUrl = await QRCode.toDataURL(qrText, {
        color: { dark: '#000000', light: '#ffffff' },
        width: 200,
        margin: 1,
      });
      setQrDataUrl(dataUrl);
    } catch {
      toast.error('Failed to generate QR');
    }
  };

  return (
    <>
      <DashboardTopbar title="Tools" subtitle="Free utilities for creators" />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="glass-strong rounded-2xl p-6 card-glow">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mb-4">
              <Link2 className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-semibold mb-1">URL Shortener</h3>
            <p className="text-xs text-gray-500 mb-3">Shorten any URL for sharing</p>
            <input value={url} onChange={e => setUrl(e.target.value)} className="input-field mb-2" placeholder="https://example.com/long-url" />
            <button onClick={shortenUrl} className="btn-primary w-full py-2 rounded-lg text-sm font-semibold text-white">Shorten</button>
            {shortResult && (
              <div className="mt-3 p-3 glass rounded-lg flex items-center justify-between gap-2">
                <span className="text-xs text-purple-300 font-mono">{shortResult}</span>
                <button onClick={() => { navigator.clipboard.writeText(shortResult); toast.success('Copied!'); }}>
                  <Copy className="w-3 h-3 text-gray-400" />
                </button>
              </div>
            )}
          </div>

          <div className="glass-strong rounded-2xl p-6 card-glow">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center mb-4">
              <QrCode className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-semibold mb-1">QR Code Generator</h3>
            <p className="text-xs text-gray-500 mb-3">Generate QR for your campaigns</p>
            <input value={qrText} onChange={e => setQrText(e.target.value)} className="input-field mb-2" placeholder="Enter URL or text" />
            <button onClick={generateQR} className="btn-primary w-full py-2 rounded-lg text-sm font-semibold text-white">Generate</button>
            {qrDataUrl && (
              <div className="mt-3 flex justify-center p-3 bg-white rounded-lg">
                <img src={qrDataUrl} alt="QR" className="w-32 h-32" />
              </div>
            )}
          </div>

          <div className="glass-strong rounded-2xl p-6 card-glow">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mb-4">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-semibold mb-1">Fraud Checker</h3>
            <p className="text-xs text-gray-500 mb-3">Check if a visitor is suspicious</p>
            <input className="input-field mb-2" placeholder="IP address or device ID" />
            <button onClick={() => toast.info('Fraud check requires admin API access')} className="btn-primary w-full py-2 rounded-lg text-sm font-semibold text-white">Check</button>
          </div>

          <div className="glass-strong rounded-2xl p-6 card-glow">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mb-4">
              <span className="text-white text-2xl">📊</span>
            </div>
            <h3 className="font-semibold mb-1">CPM Calculator</h3>
            <p className="text-xs text-gray-500 mb-3">Estimate your earnings</p>
            <input className="input-field mb-2" placeholder="Expected views" type="number" />
            <select className="input-field mb-2">
              <option>Tier 1 ($5/1K)</option>
              <option>Tier 2 ($2.75/1K)</option>
              <option>Tier 3 ($1/1K)</option>
            </select>
            <button onClick={() => toast.info('Calculator integration coming')} className="btn-primary w-full py-2 rounded-lg text-sm font-semibold text-white">Calculate</button>
          </div>

          <div className="glass-strong rounded-2xl p-6 card-glow">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center mb-4">
              <span className="text-white text-2xl">🎨</span>
            </div>
            <h3 className="font-semibold mb-1">UTM Builder</h3>
            <p className="text-xs text-gray-500 mb-3">Track campaign sources</p>
            <input className="input-field mb-2" placeholder="Campaign source" />
            <input className="input-field mb-2" placeholder="Medium" />
            <button onClick={() => toast.info('UTM builder integration coming')} className="btn-primary w-full py-2 rounded-lg text-sm font-semibold text-white">Build</button>
          </div>

          <div className="glass-strong rounded-2xl p-6 card-glow">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center mb-4">
              <span className="text-white text-2xl">🔐</span>
            </div>
            <h3 className="font-semibold mb-1">Password Generator</h3>
            <p className="text-xs text-gray-500 mb-3">Create secure passwords</p>
            <input className="input-field mb-2" placeholder="Length (16)" type="number" defaultValue={16} />
            <button onClick={() => {
              const len = 16;
              const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
              let pwd = '';
              for (let i = 0; i < len; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
              navigator.clipboard.writeText(pwd);
              toast.success('Password copied to clipboard!');
            }} className="btn-primary w-full py-2 rounded-lg text-sm font-semibold text-white">Generate & Copy</button>
          </div>
        </div>
      </div>
    </>
  );
}
