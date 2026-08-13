'use client';
import { useState } from 'react';
import { QrCode, Copy, KeyRound } from 'lucide-react';
import DashboardTopbar from '@/components/DashboardTopbar';
import { toast } from 'sonner';

export default function ToolsPage() {
  const [qrText, setQrText] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [pwLen, setPwLen] = useState(16);

  const generateQR = async () => {
    if (!qrText) { toast.error('Enter text or URL'); return; }
    setGenerating(true);
    try {
      // `qrcode` is a large encoder bundle that only matters once someone
      // actually presses Generate, so it is fetched on demand instead of
      // shipping in this page's initial JavaScript.
      const { default: QRCode } = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(qrText, { color: { dark: '#000000', light: '#ffffff' }, width: 240, margin: 1 });
      setQrDataUrl(dataUrl);
    } catch {
      toast.error('Failed to generate QR');
    } finally {
      setGenerating(false);
    }
  };

  const generatePassword = () => {
    const len = Math.max(8, Math.min(64, Number(pwLen) || 16));
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
    let pwd = '';
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    for (let i = 0; i < len; i++) pwd += chars[arr[i] % chars.length];
    navigator.clipboard.writeText(pwd);
    toast.success('Password copied to clipboard!');
  };

  return (
    <>
      <DashboardTopbar title="Tools" subtitle="Free utilities for creators" />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid sm:grid-cols-2 gap-4 max-w-4xl">
          <div className="glass-strong rounded-2xl p-6 card-glow">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center mb-4">
              <QrCode className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-semibold mb-1">QR Code Generator</h3>
            <p className="text-xs text-gray-500 mb-3">Generate a QR for your campaigns or links</p>
            <input value={qrText} onChange={e => setQrText(e.target.value)} className="input-field mb-2" placeholder="Enter URL or text" />
            <button onClick={generateQR} disabled={generating} className="btn-primary w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50">
              {generating ? 'Generating...' : 'Generate'}
            </button>
            {qrDataUrl && (
              <div className="mt-3 flex justify-center p-3 bg-white rounded-lg">
                <img src={qrDataUrl} alt="QR" className="w-32 h-32" />
              </div>
            )}
          </div>

          <div className="glass-strong rounded-2xl p-6 card-glow">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center mb-4">
              <KeyRound className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-semibold mb-1">Password Generator</h3>
            <p className="text-xs text-gray-500 mb-3">Create a secure password (crypto-secure random)</p>
            <input type="number" value={pwLen} onChange={e => setPwLen(parseInt(e.target.value))} min={8} max={64} className="input-field mb-2" placeholder="Length" />
            <button onClick={generatePassword} className="btn-primary w-full py-2 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2">
              <Copy className="w-4 h-4" /> Generate & Copy
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
