import React, { useState } from 'react';
import type { BookingDetail, EventInfo } from '../../shared/types';
import { formatWhatsAppDisplay } from '../../shared/seatRules';
import { ThemeToggleButton, type ThemeMode } from '../theme';

interface TicketViewProps {
  booking: BookingDetail;
  event: EventInfo;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onBack: () => void;
  onStartChangeSeat: (booking: BookingDetail) => void;
  onCancelBooking: (booking: BookingDetail) => Promise<void>;
}

export const TicketView: React.FC<TicketViewProps> = ({
  booking,
  event,
  theme,
  onToggleTheme,
  onBack,
  onStartChangeSeat,
  onCancelBooking,
}) => {
  const [copied, setCopied] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isCouple = booking.mode === 'suami_istri';
  const primarySeat = booking.seats[0];
  const seatSummary = booking.seats.map((s) => s.label).join(' & ');
  const isFemale = primarySeat?.jenisKelamin === 'P';

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(booking.kodeBooking);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadImage = () => {
    const canvas = document.createElement('canvas');
    const w = 840;
    const h = 1080;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    // Card
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(40, 40, w - 80, h - 80, 28);
    ctx.fill();
    ctx.stroke();

    // Navy Header
    const grad = ctx.createLinearGradient(40, 40, w - 40, 220);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#172554');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(40, 40, w - 80, 190, [28, 28, 0, 0]);
    ctx.fill();

    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('E-TIKET TRANSIT RESMI • ' + booking.kodeBooking, 80, 96);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(event.nama.slice(0, 38), 80, 146);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '20px sans-serif';
    ctx.fillText(
      `Armada ${booking.busNama} • ${booking.busTipeArmada}${booking.busPlatNomor ? ` (${booking.busPlatNomor})` : ''}`,
      80,
      188
    );

    // Dashed line
    ctx.strokeStyle = '#e2e8f0';
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(70, 260);
    ctx.lineTo(w - 70, 260);
    ctx.stroke();
    ctx.setLineDash([]);

    // Seat Box
    ctx.fillStyle = '#eff6ff';
    ctx.beginPath();
    ctx.roundRect(80, 295, 320, 190, 20);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('NOMOR KURSI', 110, 336);
    ctx.fillStyle = '#1d4ed8';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText(seatSummary, 110, 415);
    ctx.fillStyle = '#475569';
    ctx.font = '18px sans-serif';
    ctx.fillText(
      primarySeat?.tipe === 'leg_rest' ? 'Tipe Leg Rest' : 'Seat Belakang',
      110,
      455
    );

    // Passenger Box
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(430, 295, 330, 190, 20);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('PENUMPANG', 460, 336);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px sans-serif';
    if (isCouple && booking.seats.length === 2) {
      ctx.fillText(`Suami: ${booking.seats[0].namaPenumpang.slice(0, 18)}`, 460, 388);
      ctx.fillText(`Istri: ${booking.seats[1].namaPenumpang.slice(0, 18)}`, 460, 426);
      ctx.fillStyle = '#059669';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('Mode Suami & Istri', 460, 460);
    } else {
      ctx.fillText(booking.namaPemesan.slice(0, 22), 460, 395);
      ctx.fillStyle = isFemale ? '#e11d48' : '#2563eb';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(isFemale ? 'Perempuan (P)' : 'Laki-laki (L)', 460, 435);
      ctx.fillStyle = '#64748b';
      ctx.font = '18px sans-serif';
      ctx.fillText('Pemesanan Sendiri', 460, 464);
    }

    // Details box
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(80, 520, w - 160, 320, 20);
    ctx.fill();

    const rows = [
      ['WAKTU KEBERANGKATAN', `${event.tanggal} • ${event.jamBerangkat}`],
      ['TITIK KUMPUL PANITIA', event.lokasiBerangkat],
      ['KETERANGAN LOKASI', event.titikKumpulDetail || 'Hadir 30 menit sebelum berangkat'],
      ['NO. WHATSAPP TERDAFTAR', formatWhatsAppDisplay(booking.noWhatsapp)],
    ];
    let y = 570;
    for (const [k, v] of rows) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(k, 110, y);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 21px sans-serif';
      ctx.fillText(v.slice(0, 48), 110, y + 30);
      y += 72;
    }

    // Footer
    ctx.fillStyle = '#475569';
    ctx.font = '18px sans-serif';
    ctx.fillText('Tiket sah terintegrasi sistem panitia • Tanpa biaya', 80, 920);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('PANITIA TRANSIT', w - 240, 920);

    const link = document.createElement('a');
    link.download = `E-Tiket-${booking.kodeBooking}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleConfirmCancel = async () => {
    setCancelling(true);
    setErrorMsg(null);
    try {
      await onCancelBooking(booking);
      setConfirmCancelOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membatalkan pesanan.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      {/* Header */}
      <header className="no-print fixed top-0 w-full z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="h-14 px-4 max-w-md mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Kembali"
              onClick={onBack}
              className="w-10 h-10 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:text-slate-900 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back</span>
            </button>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold tracking-wider text-blue-600 dark:text-blue-400">
                Transit Event
              </span>
              <h1 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                Konfirmasi Pemesanan
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggleButton theme={theme} onToggle={onToggleTheme} compact />
            <div className="px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-bold font-mono">
              {booking.kodeBooking}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full pt-16 pb-10 px-4 max-w-md mx-auto">
        <div className="flex flex-col w-full pt-3">
          {/* Status Sukses Hero */}
          <div className="no-print flex flex-col items-center text-center mb-5">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shadow-sm mb-2.5">
              <span
                className="material-symbols-outlined text-emerald-600 dark:text-emerald-400 text-[32px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                check_circle
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold tracking-wide mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {booking.status === 'aktif' ? 'Terverifikasi Sistem' : 'Pesanan Dibatalkan'}
            </span>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {booking.status === 'aktif' ? 'Kursi Berhasil Dipesan!' : 'Pesanan Telah Dibatalkan'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
              E-Tiket resmi telah diterbitkan untuk keberangkatan rombongan Anda.
            </p>
            <button
              type="button"
              onClick={handleCopyCode}
              className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-xs"
            >
              <span className="font-mono text-blue-700 dark:text-blue-400">{booking.kodeBooking}</span>
              <span className="material-symbols-outlined text-[14px] text-slate-500 dark:text-slate-400">
                {copied ? 'check' : 'content_copy'}
              </span>
              {copied && <span className="text-emerald-600 dark:text-emerald-400">Tersalin</span>}
            </button>
          </div>

          {/* E-Tiket Boarding Pass */}
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md overflow-hidden mb-4">
            {/* Top Navy Header */}
            <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="material-symbols-outlined text-blue-300 text-[16px]">verified</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-200">
                      E-Tiket Transit Resmi • {booking.kodeBooking}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white leading-tight">{event.nama}</h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Armada {booking.busNama} • {booking.busTipeArmada}
                    {booking.busPlatNomor ? ` (${booking.busPlatNomor})` : ''}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0 text-white">
                  <span className="material-symbols-outlined text-[22px]">directions_bus</span>
                </div>
              </div>
            </div>

            {/* Cutout Notch & Dashed Separator */}
            <div className="relative flex items-center justify-between px-2 bg-white dark:bg-slate-900 py-1">
              <div className="w-4 h-5 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 rounded-r-full -ml-3" />
              <div className="flex-1 border-b-2 border-dashed border-slate-200 dark:border-slate-700 mx-2" />
              <div className="w-4 h-5 bg-slate-50 dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 rounded-l-full -mr-3" />
            </div>

            {/* Ticket Body */}
            <div className="p-4 pt-1 flex flex-col gap-3.5">
              {/* Seat & Passenger Bento */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700 p-3 rounded-xl flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-1 gap-1">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      No. Kursi
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[10px] font-extrabold uppercase">
                      {primarySeat?.tipe === 'leg_rest' ? 'Leg Rest' : 'Belakang'}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5 my-0.5 flex-wrap">
                    <span className="text-2xl font-black text-blue-700 dark:text-blue-400 tracking-tight">
                      {seatSummary}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isCouple
                      ? '2 Kursi Gandeng Pasutri'
                      : `${primarySeat?.posisiDesc ?? ''} • Baris ${primarySeat?.baris ?? ''}`}
                  </span>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700 p-3 rounded-xl flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      Penumpang
                    </span>
                    {isCouple ? (
                      <span
                        className="material-symbols-outlined text-[16px] text-rose-500"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        favorite
                      </span>
                    ) : (
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                          isFemale
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                            : 'bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300'
                        }`}
                      >
                        {primarySeat?.jenisKelamin}
                      </span>
                    )}
                  </div>

                  {isCouple ? (
                    <div className="space-y-0.5">
                      {booking.seats.map((s) => (
                        <div key={s.label} className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          <span className="text-[10px] uppercase text-slate-500 dark:text-slate-400 mr-1">
                            {s.peranPasangan === 'suami' ? 'Suami:' : 'Istri:'}
                          </span>
                          {s.namaPenumpang}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                        {booking.namaPemesan}
                      </h4>
                      <span
                        className={`inline-flex items-center gap-0.5 text-xs font-semibold mt-0.5 ${
                          isFemale ? 'text-rose-600 dark:text-rose-400' : 'text-sky-700 dark:text-sky-400'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {isFemale ? 'female' : 'male'}
                        </span>
                        {isFemale ? 'Perempuan' : 'Laki-laki'}
                      </span>
                    </div>
                  )}

                  <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {isCouple ? 'Suami & Istri' : 'Pemesanan Sendiri'}
                  </span>
                </div>
              </div>

              {/* Departure & Meeting Point */}
              <div className="bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700 rounded-xl p-3.5 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[18px]">calendar_clock</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      Waktu Keberangkatan
                    </span>
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {event.tanggal} • {event.jamBerangkat}
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-2.5 border-t border-slate-200/70 dark:border-slate-700">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[18px]">pin_drop</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      Titik Kumpul Panitia
                    </span>
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {event.lokasiBerangkat}
                    </span>
                    {event.titikKumpulDetail && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {event.titikKumpulDetail}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-2.5 border-t border-slate-200/70 dark:border-slate-700">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="material-symbols-outlined text-[18px]">chat</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                      No. WhatsApp Terdaftar
                    </span>
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100 font-mono">
                      {formatWhatsAppDisplay(booking.noWhatsapp)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Official Stamp Seal */}
              <div className="flex items-center justify-between pt-1 pb-0.5 px-1 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-400 text-[18px]">verified_user</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    Tiket sah terintegrasi sistem panitia
                  </span>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                  PANITIA TRANSIT
                </span>
              </div>
            </div>
          </div>

          {/* Comfort Policy Notice */}
          <div className="no-print bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl p-3 flex items-start gap-2.5 mb-3 shadow-sm">
            <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0 mt-0.5">
              <span
                className="material-symbols-outlined text-[16px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                shield_with_heart
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-blue-900 dark:text-blue-200">
                Aturan Kenyamanan Penumpang Aktif
              </span>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                {isCouple
                  ? `Kursi istri (${booking.seats.find((s) => s.peranPasangan === 'istri')?.label ?? ''}) tetap terlindungi dan kursi di sebelahnya khusus untuk penumpang perempuan.`
                  : isFemale
                  ? 'Kursi kosong di sebelah Anda otomatis terkunci khusus penumpang perempuan untuk kenyamanan bersama.'
                  : 'Kursi Anda tercatat sesuai aturan kenyamanan dan privasi penumpang perempuan.'}
              </p>
            </div>
          </div>

          {/* Arrival Notice */}
          <div className="no-print bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800 rounded-xl px-3 py-2 flex items-center gap-2 mb-5">
            <span className="material-symbols-outlined text-amber-700 dark:text-amber-400 text-[18px] shrink-0">
              schedule
            </span>
            <p className="text-[11px] text-slate-700 dark:text-amber-100">
              Harap tiba <strong className="text-slate-900 dark:text-white font-semibold">30 menit sebelum keberangkatan</strong>{' '}
              untuk presensi panitia.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="no-print flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleDownloadImage}
                className="h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/25 active:scale-[0.99] transition-all px-3"
              >
                <span className="material-symbols-outlined text-[19px]">download</span>
                <span>Simpan Gambar</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="h-12 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md active:scale-[0.99] transition-all px-3"
              >
                <span className="material-symbols-outlined text-[19px]">print</span>
                <span>Cetak / PDF</span>
              </button>
            </div>

            {booking.status === 'aktif' && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onStartChangeSeat(booking)}
                  className="h-11 rounded-xl bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/60 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[17px]">swap_horiz</span>
                  <span>Ubah Kursi</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCancelOpen(true)}
                  className="h-11 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[17px]">cancel</span>
                  <span>Batalkan Kursi</span>
                </button>
              </div>
            )}

            <div className="flex justify-center mt-1">
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-400 font-medium transition-colors py-2 px-3"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                <span>Kembali ke Denah Utama</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Cancel Confirmation Modal */}
      {confirmCancelOpen && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined">warning</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Batalkan Reservasi?</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                  {isCouple
                    ? `Membatalkan pesanan ${booking.kodeBooking} akan melepas kedua kursi (${seatSummary}) sekaligus agar dapat dipesan peserta lain.`
                    : `Membatalkan pesanan ${booking.kodeBooking} akan melepas kursi ${seatSummary} agar dapat dipesan peserta lain.`}
                </p>
              </div>
            </div>
            {errorMsg && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                {errorMsg}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmCancelOpen(false)}
                disabled={cancelling}
                className="flex-1 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs"
              >
                Tidak, Simpan
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={cancelling}
                className="flex-1 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs disabled:opacity-60"
              >
                {cancelling ? 'Membatalkan...' : 'Ya, Batalkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

