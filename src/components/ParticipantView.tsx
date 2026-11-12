import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BookingDetail,
  BookingMode,
  BusInfo,
  EventInfo,
  Gender,
  ParticipantUser,
  PublicLookupBooking,
  PublicSeat,
} from '../../shared/types';
import {
  formatWhatsAppDisplay,
  getValidCoupleOrientations,
  isValidWhatsApp,
  normalizeWhatsApp,
} from '../../shared/seatRules';
import { publicApi } from '../api';
import { ThemeToggleButton, type ThemeMode } from '../theme';
import { BusSeatMap, type SelectedSeatAssignment } from './BusSeatMap';
import { TicketView } from './TicketView';

interface ParticipantViewProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onNavigateAdmin: () => void;
}

export const ParticipantView: React.FC<ParticipantViewProps> = ({
  theme,
  onToggleTheme,
  onNavigateAdmin,
}) => {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [buses, setBuses] = useState<BusInfo[]>([]);
  const [activeBusId, setActiveBusId] = useState<number | null>(null);
  const [seats, setSeats] = useState<PublicSeat[]>([]);
  const [loading, setLoading] = useState(true);

  // Booking form state
  const [mode, setMode] = useState<BookingMode>('sendiri');
  const [gender, setGender] = useState<Gender | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<SelectedSeatAssignment[]>([]);
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number>(0);

  const [namaPemesan, setNamaPemesan] = useState('');
  const [namaIstri, setNamaIstri] = useState('');
  const [noWhatsapp, setNoWhatsapp] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Feedback / Toast
  const [alertBanner, setAlertBanner] = useState<{ type: 'error' | 'info' | 'success'; text: string } | null>(
    null
  );

  // Active Ticket & Change Seat mode
  const [activeTicket, setActiveTicket] = useState<BookingDetail | null>(null);
  const [changeSeatBooking, setChangeSeatBooking] = useState<{
    booking: BookingDetail;
    rawWhatsapp: string;
  } | null>(null);

  // Lookup / Cancel section
  const [lookupWa, setLookupWa] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResults, setLookupResults] = useState<PublicLookupBooking[] | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PublicLookupBooking | null>(null);

  // Participant Email Auth (No password)
  const [participant, setParticipant] = useState<ParticipantUser | null>(null);
  const [myBookings, setMyBookings] = useState<BookingDetail[]>([]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authNama, setAuthNama] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  // Modals & Navigation
  const [activeTab, setActiveTab] = useState<'kursi' | 'jadwal' | 'tiket' | 'event' | 'profil'>('kursi');
  const [infoModal, setInfoModal] = useState<'jadwal' | 'event' | null>(null);

  const mapSectionRef = useRef<HTMLDivElement>(null);
  const formSectionRef = useRef<HTMLDivElement>(null);
  const lookupSectionRef = useRef<HTMLDivElement>(null);
  const lookupInputRef = useRef<HTMLInputElement>(null);

  const activeBus = useMemo(
    () => buses.find((b) => b.id === activeBusId) ?? buses[0] ?? null,
    [buses, activeBusId]
  );

  const allBusesFull = useMemo(
    () => buses.length > 0 && buses.every((b) => b.availableSeats === 0),
    [buses]
  );

  const loadParticipantSession = useCallback(async () => {
    try {
      const meRes = await publicApi.authMe();
      setParticipant(meRes.participant);
      if (meRes.participant) {
        const mb = await publicApi.getMyBookings();
        setMyBookings(mb.bookings);
        setNamaPemesan((prev) => prev || meRes.participant!.nama);
        if (meRes.participant.noWhatsapp) {
          setNoWhatsapp(formatWhatsAppDisplay(meRes.participant.noWhatsapp));
        }
      } else {
        setMyBookings([]);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadInitialData = useCallback(async (preferredBusId?: number) => {
    try {
      const [evData] = await Promise.all([publicApi.getEvent(), loadParticipantSession()]);
      setEvent(evData.event);
      setBuses(evData.buses);
      const targetBusId =
        preferredBusId && evData.buses.some((b) => b.id === preferredBusId)
          ? preferredBusId
          : evData.buses[0]?.id ?? null;

      if (targetBusId) {
        setActiveBusId(targetBusId);
        const seatData = await publicApi.getBusSeats(targetBusId);
        setSeats(seatData.seats);
      }
    } catch (err) {
      setAlertBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memuat data event.',
      });
    } finally {
      setLoading(false);
    }
  }, [loadParticipantSession]);

  const refreshBusSeats = useCallback(async (busId: number) => {
    try {
      const [evData, seatData] = await Promise.all([
        publicApi.getEvent(),
        publicApi.getBusSeats(busId),
      ]);
      setEvent(evData.event);
      setBuses(evData.buses);
      setSeats(seatData.seats);
    } catch {
      // ignore background refresh error
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Real-time SSE + 6s fallback polling (gracefully falls back to polling on Vercel serverless)
  useEffect(() => {
    if (!activeBusId) return;
    const es = new EventSource('/api/stream');
    es.addEventListener('seat-update', () => {
      refreshBusSeats(activeBusId);
    });
    es.onerror = () => {
      es.close();
    };
    const timer = setInterval(() => {
      refreshBusSeats(activeBusId);
    }, 6000);
    return () => {
      es.close();
      clearInterval(timer);
    };
  }, [activeBusId, refreshBusSeats]);

  // Hold countdown ticker
  useEffect(() => {
    if (!holdExpiresAt) {
      setHoldSecondsLeft(0);
      return;
    }
    const tick = () => {
      const diff = Math.max(0, Math.floor((holdExpiresAt - Date.now()) / 1000));
      setHoldSecondsLeft(diff);
      if (diff === 0) {
        setHoldExpiresAt(null);
        setSelectedSeats([]);
        setAlertBanner({
          type: 'info',
          text: 'Waktu penahanan kursi habis. Silakan pilih kursi Anda kembali.',
        });
        if (activeBusId) refreshBusSeats(activeBusId);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt, activeBusId, refreshBusSeats]);

  // Clear selection helper
  const clearSelection = useCallback(async () => {
    setSelectedSeats([]);
    setHoldExpiresAt(null);
    try {
      await publicApi.releaseHold();
    } catch {
      // ignore
    }
  }, []);

  const handleModeChange = async (nextMode: BookingMode) => {
    if (changeSeatBooking) return; // locked during seat-change
    if (nextMode === mode) return;
    setMode(nextMode);
    setAlertBanner(null);
    await clearSelection();
  };

  const handleGenderChange = async (nextGender: Gender) => {
    if (changeSeatBooking) return;
    if (nextGender === gender) return;
    setGender(nextGender);
    setAlertBanner(null);
    await clearSelection();
  };

  const handleBusChange = async (busId: number) => {
    if (busId === activeBusId) return;
    setActiveBusId(busId);
    setAlertBanner(null);
    await clearSelection();
    await refreshBusSeats(busId);
  };

  const ignoreSeatLabels = useMemo(() => {
    if (!changeSeatBooking || changeSeatBooking.booking.busId !== activeBusId) return [];
    return changeSeatBooking.booking.seats.map((s) => s.label);
  }, [changeSeatBooking, activeBusId]);

  const seatsMap = useMemo(() => new Map(seats.map((s) => [s.label, s])), [seats]);

  const applyHold = async (nextSelected: SelectedSeatAssignment[]) => {
    if (!activeBusId) return;
    if (nextSelected.length === 0) {
      await clearSelection();
      return;
    }
    const holdPayload = nextSelected.map((item) => ({
      label: item.label,
      gender:
        mode === 'sendiri'
          ? (gender as Gender)
          : item.role === 'istri'
          ? ('P' as Gender)
          : ('L' as Gender),
    }));

    try {
      const res = await publicApi.holdSeats({
        busId: activeBusId,
        mode,
        seats: holdPayload,
        ignoreSeatLabels,
      });
      setSelectedSeats(nextSelected);
      setHoldExpiresAt(Date.parse(res.expiresAt));
      await refreshBusSeats(activeBusId);
    } catch (err) {
      setAlertBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Kursi baru saja dipesan peserta lain.',
      });
      await clearSelection();
      await refreshBusSeats(activeBusId);
    }
  };

  const handleSelectSeat = async (seat: PublicSeat) => {
    setAlertBanner(null);
    if (!participant) {
      setAuthError(null);
      setAuthTab('login');
      setAuthModalOpen(true);
      setAlertBanner({
        type: 'info',
        text: 'Silakan masuk atau daftar dengan Email terlebih dahulu untuk memilih & memesan kursi.',
      });
      return;
    }
    if (event?.statusPendaftaran !== 'buka') {
      setAlertBanner({ type: 'error', text: 'Maaf, pendaftaran kursi sedang ditutup oleh panitia.' });
      return;
    }

    if (mode === 'sendiri') {
      if (selectedSeats.some((s) => s.label === seat.label)) {
        await clearSelection();
        return;
      }
      await applyHold([{ label: seat.label }]);
      return;
    }

    // Mode Suami & Istri
    const alreadyIdx = selectedSeats.findIndex((s) => s.label === seat.label);
    if (alreadyIdx !== -1) {
      if (selectedSeats.length === 2) {
        const remaining = selectedSeats.filter((s) => s.label !== seat.label);
        await applyHold(remaining);
      } else {
        await clearSelection();
      }
      return;
    }

    if (selectedSeats.length === 1) {
      const first = seatsMap.get(selectedSeats[0].label);
      if (first && first.adjacentLabels.includes(seat.label)) {
        const orient = getValidCoupleOrientations(first, seat, seatsMap, { ignoreSeatLabels });
        if (orient.aAsSuami) {
          await applyHold([
            { label: first.label, role: 'suami' },
            { label: seat.label, role: 'istri' },
          ]);
          return;
        }
        if (orient.bAsSuami) {
          await applyHold([
            { label: first.label, role: 'istri' },
            { label: seat.label, role: 'suami' },
          ]);
          setAlertBanner({
            type: 'info',
            text: `Posisi otomatis disesuaikan: Istri di ${first.label} & Suami di ${seat.label} agar mematuhi aturan kursi perempuan.`,
          });
          return;
        }
      }
    }

    // Start new 1st couple pick
    await applyHold([{ label: seat.label, role: 'suami' }]);
  };

  const handleSwapCoupleRoles = async () => {
    if (mode !== 'suami_istri' || selectedSeats.length !== 2) return;
    const seatA = seatsMap.get(selectedSeats[0].label);
    const seatB = seatsMap.get(selectedSeats[1].label);
    if (!seatA || !seatB) return;

    const swapped: SelectedSeatAssignment[] = selectedSeats.map((s) => ({
      label: s.label,
      role: s.role === 'suami' ? 'istri' : 'suami',
    }));
    const newSuami = swapped[0].role === 'suami' ? seatA : seatB;
    const newIstri = swapped[0].role === 'istri' ? seatA : seatB;
    const orient = getValidCoupleOrientations(newSuami, newIstri, seatsMap, { ignoreSeatLabels });
    if (!orient.aAsSuami) {
      setAlertBanner({
        type: 'error',
        text: orient.errorReason ?? 'Penukaran posisi akan melanggar aturan kursi perempuan di sebelahnya.',
      });
      return;
    }
    setAlertBanner(null);
    await applyHold(swapped);
  };

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertBanner(null);

    if (!activeBus) return;
    if (!participant) {
      setAuthError(null);
      setAuthTab('login');
      setAuthModalOpen(true);
      return;
    }
    if (event?.statusPendaftaran !== 'buka') {
      setAlertBanner({ type: 'error', text: 'Pendaftaran sedang ditutup.' });
      return;
    }

    if (mode === 'sendiri') {
      if (!gender) {
        setAlertBanner({ type: 'error', text: 'Silakan pilih jenis kelamin terlebih dahulu.' });
        return;
      }
      if (selectedSeats.length !== 1) {
        setAlertBanner({ type: 'error', text: 'Silakan ketuk 1 kursi di denah terlebih dahulu.' });
        return;
      }
    } else {
      if (selectedSeats.length !== 2) {
        setAlertBanner({
          type: 'error',
          text: 'Mode Suami & Istri wajib memilih 2 kursi yang bersebelahan di denah.',
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      if (changeSeatBooking) {
        const res = await publicApi.changeBookingSeats(changeSeatBooking.booking.id, {
          noWhatsapp: changeSeatBooking.rawWhatsapp,
          busId: activeBus.id,
          seats: selectedSeats,
        });
        setChangeSeatBooking(null);
        setSelectedSeats([]);
        setHoldExpiresAt(null);
        setActiveTicket(res.booking);
        await Promise.all([refreshBusSeats(activeBus.id), loadParticipantSession()]);
      } else {
        const normWa = normalizeWhatsApp(noWhatsapp);
        if (!isValidWhatsApp(normWa)) {
          setAlertBanner({
            type: 'error',
            text: 'Nomor WhatsApp tidak valid. Gunakan awalan 08xx atau 628xx.',
          });
          setSubmitting(false);
          return;
        }
        const res = await publicApi.createBooking({
          busId: activeBus.id,
          mode,
          namaPemesan,
          namaIstri: mode === 'suami_istri' ? namaIstri : undefined,
          gender: mode === 'sendiri' ? gender ?? undefined : undefined,
          noWhatsapp,
          seats: selectedSeats,
        });
        setSelectedSeats([]);
        setHoldExpiresAt(null);
        setActiveTicket(res.booking);
        await Promise.all([refreshBusSeats(activeBus.id), loadParticipantSession()]);
      }
    } catch (err) {
      setAlertBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memproses pemesanan kursi.',
      });
      await refreshBusSeats(activeBus.id);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLookupSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLookupError(null);
    setLookupLoading(true);
    try {
      const res = await publicApi.lookupBookings(lookupWa);
      setLookupResults(res.bookings);
    } catch (err) {
      setLookupResults(null);
      setLookupError(err instanceof Error ? err.message : 'Gagal mencari pesanan.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleOpenTicketFromLookup = async (kodeBooking: string) => {
    try {
      const res = await publicApi.getTicket(kodeBooking, lookupWa);
      setActiveTicket(res.booking);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Gagal membuka E-Tiket.');
    }
  };

  const handleStartChangeSeat = async (booking: BookingDetail, rawWaOverride?: string) => {
    const waToUse = rawWaOverride || booking.noWhatsapp;
    setActiveTicket(null);
    setChangeSeatBooking({ booking, rawWhatsapp: waToUse });
    setMode(booking.mode);
    if (booking.mode === 'sendiri') {
      setGender(booking.seats[0]?.jenisKelamin ?? 'L');
      setNamaPemesan(booking.namaPemesan);
    } else {
      const suami = booking.seats.find((s) => s.peranPasangan === 'suami');
      const istri = booking.seats.find((s) => s.peranPasangan === 'istri');
      setNamaPemesan(suami?.namaPenumpang ?? '');
      setNamaIstri(istri?.namaPenumpang ?? '');
      setGender(null);
    }
    setNoWhatsapp(booking.noWhatsapp);
    await clearSelection();
    if (booking.busId !== activeBusId) {
      setActiveBusId(booking.busId);
    }
    await refreshBusSeats(booking.busId);
    setAlertBanner({
      type: 'info',
      text: `Pilih kursi baru untuk pesanan ${booking.kodeBooking} (kursi lama: ${booking.seats
        .map((s) => s.label)
        .join(' & ')}).`,
    });
    mapSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleCancelFromTicket = async (booking: BookingDetail) => {
    const res = await publicApi.cancelBooking(booking.id, booking.noWhatsapp);
    setActiveTicket(res.booking);
    await Promise.all([
      activeBusId ? refreshBusSeats(activeBusId) : Promise.resolve(),
      loadParticipantSession(),
    ]);
  };

  const handleAuthLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await publicApi.authLogin(authEmail);
      setParticipant(res.participant);
      setAuthModalOpen(false);
      await loadParticipantSession();
      setAlertBanner({
        type: 'success',
        text: `Selamat datang, ${res.participant.nama}! Anda sudah dapat memilih dan memesan kursi.`,
      });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Gagal masuk.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuthRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await publicApi.authRegister({
        email: authEmail,
        nama: authNama,
      });
      setParticipant(res.participant);
      setAuthModalOpen(false);
      await loadParticipantSession();
      setAlertBanner({
        type: 'success',
        text: `Pendaftaran berhasil untuk ${res.participant.email}! Silakan pilih kursi di denah.`,
      });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Gagal mendaftar.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuthLogout = async () => {
    setProfileModalOpen(false);
    await clearSelection();
    await publicApi.authLogout();
    setParticipant(null);
    setMyBookings([]);
    setNamaPemesan('');
    setNoWhatsapp('');
    setAlertBanner({ type: 'info', text: 'Anda telah keluar. Sekarang berada dalam mode tamu.' });
  };

  const handleConfirmLookupCancel = async () => {
    if (!cancelTarget) return;
    try {
      await publicApi.cancelBooking(cancelTarget.id, lookupWa);
      setCancelTarget(null);
      setAlertBanner({
        type: 'success',
        text: `Pesanan ${cancelTarget.kodeBooking} berhasil dibatalkan. Kursi telah dilepas kembali.`,
      });
      await handleLookupSearch();
      if (activeBusId) await refreshBusSeats(activeBusId);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Gagal membatalkan pesanan.');
      setCancelTarget(null);
    }
  };

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (loading || !event) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-slate-600">
          <span className="material-symbols-outlined text-4xl text-blue-600 animate-spin">
            progress_activity
          </span>
          <p className="text-sm font-semibold">Memuat denah kursi event...</p>
        </div>
      </div>
    );
  }

  if (activeTicket) {
    return (
      <TicketView
        booking={activeTicket}
        event={event}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onBack={() => setActiveTicket(null)}
        onStartChangeSeat={(b) => handleStartChangeSeat(b)}
        onCancelBooking={handleCancelFromTicket}
      />
    );
  }

  const registrationClosed = event.statusPendaftaran !== 'buka';

  return (
    <div className="min-h-screen bg-slate-50/70 dark:bg-slate-950 flex flex-col">
      {/* Fixed Header */}
      <header className="fixed top-0 w-full z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 shadow-sm">
        <div className="h-15 px-4 max-w-lg mx-auto flex items-center justify-between gap-2">
          <div className="flex flex-col justify-center min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[18px]">
                directions_bus
              </span>
              <span className="text-[11px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-bold">
                TRANSIT EVENT
              </span>
            </div>
            <h1 className="text-base text-slate-900 dark:text-white leading-tight font-bold truncate">
              Pemesanan Kursi
            </h1>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {participant ? (
              <button
                type="button"
                onClick={() => setProfileModalOpen(true)}
                title={`Profil: ${participant.nama} (${participant.email})`}
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 text-xs font-bold transition-colors"
              >
                <span className="material-symbols-outlined text-[16px] shrink-0">account_circle</span>
                <span>Profil</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAuthError(null);
                  setAuthTab('login');
                  setAuthModalOpen(true);
                }}
                className="inline-flex items-center gap-1 px-3 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">login</span>
                <span>Masuk</span>
              </button>
            )}
            <ThemeToggleButton theme={theme} onToggle={onToggleTheme} compact />
            <button
              type="button"
              onClick={onNavigateAdmin}
              title="Portal Admin / Panitia"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:text-blue-700 transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">admin_panel_settings</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full pt-19 pb-24 px-4 max-w-lg mx-auto flex flex-col gap-5">
        {/* Change-Seat Banner (FR-12) */}
        {changeSeatBooking && (
          <div className="p-3.5 rounded-2xl bg-blue-600 text-white shadow-md flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined text-[20px] mt-0.5">swap_horiz</span>
              <div className="text-xs leading-relaxed">
                <div className="font-bold">
                  Mode Ubah Kursi ({changeSeatBooking.booking.kodeBooking})
                </div>
                <div className="text-blue-100">
                  Kursi lama: {changeSeatBooking.booking.seats.map((s) => s.label).join(' & ')}. Pilih kursi
                  baru lalu klik simpan.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                setChangeSeatBooking(null);
                setNamaPemesan('');
                setNamaIstri('');
                setNoWhatsapp('');
                await clearSelection();
              }}
              className="px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-[11px] font-bold shrink-0"
            >
              Batal
            </button>
          </div>
        )}

        {/* 1. Header Info Event Card */}
        <section className="w-full bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 flex flex-col gap-3 relative overflow-hidden">
          <div className="relative z-10 flex items-center justify-between gap-2 flex-wrap">
            {registrationClosed ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[11px] uppercase tracking-wider font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                Pendaftaran Ditutup
              </span>
            ) : allBusesFull ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] uppercase tracking-wider font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Semua Bus Penuh
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] uppercase tracking-wider font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Pendaftaran Dibuka
              </span>
            )}

            {activeBus && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-[11px]">
                <span className="material-symbols-outlined text-[15px] text-blue-600 dark:text-blue-400">
                  airline_seat_recline_normal
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {activeBus.nama}: {activeBus.availableSeats}/{activeBus.totalSeats} Tersedia
                </span>
              </div>
            )}
          </div>

          <div>
            <h2 className="text-lg sm:text-xl text-slate-900 font-bold leading-snug">{event.nama}</h2>
            <div className="flex flex-col gap-1.5 mt-2 text-slate-600 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-blue-600 text-[16px]">calendar_today</span>
                <span className="font-medium text-slate-700">
                  {event.tanggal} • {event.jamBerangkat}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-emerald-600 text-[16px]">location_on</span>
                <span className="text-slate-700">Titik Kumpul: {event.lokasiBerangkat}</span>
              </div>
            </div>
          </div>
        </section>

        {/* 1B. Mode Tamu */}
        {!participant && (
          <section className="w-full bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/80 rounded-2xl p-3.5 flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-start gap-2.5 min-w-0">
              <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[20px] shrink-0 mt-0.5">
                mail
              </span>
              <div className="text-xs leading-relaxed">
                <div className="font-bold text-blue-950 dark:text-blue-200">Mode Tamu (Lihat Denah)</div>
                <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                  Masuk atau daftar dengan <strong>Email</strong> untuk memesan kursi dan melihat E-Tiket Anda.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setAuthError(null);
                setAuthTab('login');
                setAuthModalOpen(true);
              }}
              className="shrink-0 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs"
            >
              Masuk / Daftar
            </button>
          </section>
        )}

        {/* 2. Mode Switcher & Bus Selector */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-slate-700 font-semibold">Tipe Reservasi:</span>
            <div className="grid grid-cols-2 p-1.5 bg-slate-100/90 border border-slate-200/70 rounded-xl gap-1">
              <button
                type="button"
                disabled={Boolean(changeSeatBooking)}
                onClick={() => handleModeChange('sendiri')}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-sm transition-all ${
                  mode === 'sendiri'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 font-semibold'
                } disabled:opacity-70`}
              >
                <span className="material-symbols-outlined text-[18px]">person</span>
                <span>Sendiri</span>
              </button>
              <button
                type="button"
                disabled={Boolean(changeSeatBooking)}
                onClick={() => handleModeChange('suami_istri')}
                className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-sm transition-all ${
                  mode === 'suami_istri'
                    ? 'bg-blue-600 text-white font-bold shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 font-semibold'
                } disabled:opacity-70`}
              >
                <span className="material-symbols-outlined text-[18px]">group</span>
                <span>Suami &amp; Istri</span>
              </button>
            </div>
          </div>

          {/* Bus Selector Chips / Card */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-slate-700 font-semibold">Armada Bus:</span>
              <span className="text-[11px] text-blue-600 font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px]">directions_bus</span>
                {buses.length > 1 ? `${buses.length} Bus Tersedia` : 'Bus Tunggal Resmi'}
              </span>
            </div>

            {buses.length > 1 && (
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {buses.map((b) => {
                  const isActive = b.id === activeBus?.id;
                  const isFull = b.availableSeats === 0;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleBusChange(b.id)}
                      className={`shrink-0 px-3.5 py-2 rounded-xl border text-left transition-all ${
                        isActive
                          ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                          : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300'
                      }`}
                    >
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <span>{b.nama}</span>
                        {isFull && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${
                              isActive ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700'
                            }`}
                          >
                            PENUH
                          </span>
                        )}
                      </div>
                      <div className={`text-[11px] ${isActive ? 'text-blue-100' : 'text-slate-500'}`}>
                        {b.availableSeats} dari {b.totalSeats} seat
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {activeBus && (
              <div className="flex items-center justify-between p-3 rounded-2xl bg-white border border-blue-200 shadow-sm gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                    <span className="material-symbols-outlined text-[22px]">directions_bus</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-slate-900 font-bold">{activeBus.nama}</span>
                      {activeBus.platNomor && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-medium border border-slate-200">
                          {activeBus.platNomor}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500 mt-0.5 truncate">
                      {activeBus.tipeArmada}
                    </span>
                  </div>
                </div>
                <div className="shrink-0">
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                      activeBus.availableSeats === 0
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        activeBus.availableSeats === 0 ? 'bg-rose-500' : 'bg-emerald-500'
                      }`}
                    />
                    {activeBus.availableSeats === 0
                      ? 'Penuh'
                      : `${activeBus.availableSeats}/${activeBus.totalSeats} Tersedia`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 3. Gender Selector (Mode Sendiri) OR Couple Guide */}
          {mode === 'sendiri' ? (
            <div className="flex flex-col gap-2.5 p-4 bg-white border border-slate-200/80 rounded-2xl shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-slate-800 font-semibold">
                  Jenis Kelamin Pemesan <span className="text-rose-600">*</span>
                </span>
                {!gender && (
                  <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">
                    Wajib dipilih
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={Boolean(changeSeatBooking)}
                  onClick={() => handleGenderChange('L')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border transition-all ${
                    gender === 'L'
                      ? 'border-2 border-sky-400 bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 font-bold shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 font-semibold'
                  } disabled:opacity-75`}
                >
                  <span className="material-symbols-outlined text-[18px]">male</span>
                  <span className="text-xs sm:text-[13px]">Laki-laki</span>
                </button>
                <button
                  type="button"
                  disabled={Boolean(changeSeatBooking)}
                  onClick={() => handleGenderChange('P')}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border transition-all ${
                    gender === 'P'
                      ? 'border-2 border-pink-300 bg-pink-50 dark:bg-pink-950/55 text-pink-700 dark:text-pink-200 font-bold shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 font-semibold'
                  } disabled:opacity-75`}
                >
                  <span className="material-symbols-outlined text-[18px]">female</span>
                  <span className="text-xs sm:text-[13px]">Perempuan</span>
                </button>
              </div>
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/60 text-slate-700 mt-0.5">
                <span className="material-symbols-outlined text-emerald-600 text-[18px] shrink-0 mt-0.5">
                  verified_user
                </span>
                <p className="text-xs leading-relaxed text-slate-700">
                  {gender === 'P' ? (
                    <>
                      Anda memilih <strong className="text-pink-700 dark:text-pink-300">Perempuan</strong>. Kursi bersebelahan
                      dengan laki-laki otomatis dinonaktifkan, dan kursi berlabel <strong>KHUSUS P</strong>{' '}
                      dapat Anda pilih.
                    </>
                  ) : gender === 'L' ? (
                    <>
                      Anda memilih <strong className="text-sky-700 dark:text-sky-300">Laki-laki</strong>. Kursi di sebelah
                      penumpang perempuan ditandai <strong>KHUSUS P</strong> dan tidak dapat dipilih.
                    </>
                  ) : (
                    <>
                      Pilih <strong>Laki-laki</strong> atau <strong>Perempuan</strong> terlebih dahulu agar
                      sistem menandai kursi yang sesuai aturan kenyamanan penumpang perempuan.
                    </>
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-blue-50/80 border border-blue-200 text-slate-700">
              <span className="material-symbols-outlined text-blue-600 text-[20px] shrink-0 mt-0.5">
                wc
              </span>
              <div className="text-xs leading-relaxed">
                <div className="font-bold text-blue-900">Mode Pasangan Suami &amp; Istri</div>
                <p className="text-slate-600 mt-0.5">
                  Ketuk <strong>2 kursi bersebelahan</strong> di denah (mis. A1 &amp; A2, atau 2 kursi bersebelahan
                  di baris belakang R1–R6). Anda dapat menukar posisi kursi Suami &amp; Istri sebelum memesan.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Contextual Alert Banner */}
        {alertBanner && (
          <div
            role="alert"
            className={`p-3.5 rounded-2xl border text-xs flex items-start justify-between gap-2.5 shadow-sm ${
              alertBanner.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : alertBanner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">
                {alertBanner.type === 'error'
                  ? 'error'
                  : alertBanner.type === 'success'
                  ? 'check_circle'
                  : 'info'}
              </span>
              <span className="leading-relaxed font-medium">{alertBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setAlertBanner(null)}
              className="text-current opacity-70 hover:opacity-100"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        )}

        {/* 4. Interactive Bus Seat Map */}
        {activeBus && (
          <section ref={mapSectionRef} className="flex flex-col gap-2.5 scroll-mt-20">
            <div className="flex items-center justify-between px-1 gap-2 flex-wrap">
              <div className="flex flex-col">
                <h3 className="text-base text-slate-900 font-bold">Denah Kursi {activeBus.nama}</h3>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                32 Leg Rest + 6 Belakang
              </span>
            </div>

            <BusSeatMap
              bus={activeBus}
              seats={seats}
              viewType="participant"
              mode={mode}
              gender={gender}
              selectedSeats={selectedSeats}
              ignoreSeatLabels={ignoreSeatLabels}
              onSelectSeat={handleSelectSeat}
              onRejectedClick={(reason) => {
                setAlertBanner({ type: 'error', text: reason });
              }}
            />
          </section>
        )}

        {/* 5. Booking Form Card */}
        <section
          ref={formSectionRef}
          className="p-4 bg-white border border-slate-200/80 rounded-2xl flex flex-col gap-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex flex-col">
              <h3 className="text-base text-slate-900 font-bold">
                {changeSeatBooking ? 'Konfirmasi Kursi Baru' : 'Data Pemesan Kursi'}
              </h3>
            </div>
            <div
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${
                selectedSeats.length > 0
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-slate-100 border-slate-200 text-slate-500'
              }`}
            >
              <span className="material-symbols-outlined text-[17px]">event_seat</span>
              <span>
                {selectedSeats.length === 0
                  ? 'Belum pilih seat'
                  : `Seat: ${selectedSeats.map((s) => s.label).join(' & ')}`}
              </span>
            </div>
          </div>

          {/* Couple seat assignment detail & swap button */}
          {mode === 'suami_istri' && selectedSeats.length === 2 && (
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-blue-50/70 border border-blue-200 text-xs">
              <div className="flex flex-col gap-0.5 text-slate-700">
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[15px] text-sky-500">male</span>
                  Suami:{' '}
                  <strong className="text-sky-700 dark:text-sky-300">
                    {selectedSeats.find((s) => s.role === 'suami')?.label}
                  </strong>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-[15px] text-pink-500">female</span>
                  Istri:{' '}
                  <strong className="text-pink-700 dark:text-pink-300">
                    {selectedSeats.find((s) => s.role === 'istri')?.label}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={handleSwapCoupleRoles}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-blue-200 text-blue-700 hover:bg-blue-100 font-bold text-[11px] flex items-center gap-1 shrink-0 shadow-xs"
              >
                <span className="material-symbols-outlined text-[15px]">swap_horiz</span>
                <span>Tukar Posisi</span>
              </button>
            </div>
          )}

          {/* Seat Hold Countdown */}
          {holdSecondsLeft > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-slate-800">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600 text-[20px]">timer</span>
                <span className="text-xs text-slate-700 font-medium">Kursi ditahan untuk Anda:</span>
              </div>
              <span className="text-sm text-emerald-700 font-bold font-mono">
                {formatCountdown(holdSecondsLeft)}
              </span>
            </div>
          )}

          <form onSubmit={handleSubmitBooking} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-700 font-semibold" htmlFor="nama-pemesan">
                {mode === 'suami_istri' ? 'Nama Lengkap Suami' : 'Nama Lengkap Penumpang'}
              </label>
              <input
                id="nama-pemesan"
                type="text"
                required
                disabled={Boolean(changeSeatBooking)}
                value={namaPemesan}
                onChange={(e) => setNamaPemesan(e.target.value)}
                placeholder={mode === 'suami_istri' ? 'cth. Rahmat Hidayat' : 'cth. Siti Fatimah'}
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white disabled:opacity-70"
              />
            </div>

            {mode === 'suami_istri' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-700 font-semibold" htmlFor="nama-istri">
                  Nama Lengkap Istri
                </label>
                <input
                  id="nama-istri"
                  type="text"
                  required
                  disabled={Boolean(changeSeatBooking)}
                  value={namaIstri}
                  onChange={(e) => setNamaIstri(e.target.value)}
                  placeholder="cth. Nur Aini"
                  className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white disabled:opacity-70"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-700 font-semibold" htmlFor="whatsapp">
                Nomor WhatsApp Aktif
              </label>
              <input
                id="whatsapp"
                type="tel"
                required
                disabled={Boolean(changeSeatBooking)}
                value={noWhatsapp}
                onChange={(e) => setNoWhatsapp(e.target.value)}
                placeholder="0812-XXXX-XXXX"
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-sm placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white disabled:opacity-70"
              />
              <span className="text-[11px] text-slate-500">
                Digunakan untuk cek E-Tiket atau pembatalan kursi (maks. {event.batasPesananPerWa} pesanan aktif)
              </span>
            </div>

            {!participant ? (
              <button
                type="button"
                onClick={() => {
                  setAuthError(null);
                  setAuthTab('login');
                  setAuthModalOpen(true);
                }}
                className="w-full h-12 mt-1 rounded-xl bg-blue-600 text-white text-sm font-bold shadow-md hover:bg-blue-700 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[20px]">login</span>
                <span>Masuk / Daftar Email untuk Pesan</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting || registrationClosed}
                className="w-full h-12 mt-1 rounded-xl bg-blue-600 text-white text-sm font-bold shadow-md hover:bg-blue-700 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>
                  {submitting
                    ? 'Memproses...'
                    : changeSeatBooking
                    ? 'Simpan Perubahan Kursi'
                    : 'Pesan Seat'}
                </span>
                <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
              </button>
            )}

            <div className="flex items-center justify-center gap-1.5 text-center mt-0.5">
              <span className="material-symbols-outlined text-emerald-600 text-[16px]">check_circle</span>
              <span className="text-xs text-slate-500">Tanpa biaya</span>
            </div>
          </form>
        </section>

        {/* 6. Tiket Saya (via Login Email) & Cek Pesanan */}
        <section
          ref={lookupSectionRef}
          className="p-4 bg-white border border-slate-200/80 rounded-2xl flex flex-col gap-3 shadow-sm scroll-mt-20"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-blue-600 text-[20px]">confirmation_number</span>
              <h4 className="text-sm font-bold text-slate-900">Tiket Saya</h4>
            </div>
            {participant && (
              <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full truncate max-w-[180px]">
                {participant.email}
              </span>
            )}
          </div>

          {!participant ? (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col gap-2.5 text-center">
              <p className="text-xs text-slate-600 leading-relaxed">
                Masuk dengan akun <strong>Email</strong> Anda untuk langsung melihat E-Tiket,
                mengubah kursi, atau membatalkan pesanan.
              </p>
              <button
                type="button"
                onClick={() => {
                  setAuthError(null);
                  setAuthTab('login');
                  setAuthModalOpen(true);
                }}
                className="mx-auto px-4 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">mail</span>
                <span>Masuk dengan Email</span>
              </button>
            </div>
          ) : myBookings.length === 0 ? (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 text-center">
              Belum ada pemesanan kursi untuk akun <strong>{participant.email}</strong>.
            </div>
          ) : (
            <div className="space-y-2.5">
              {myBookings.map((bk) => (
                <div
                  key={bk.id}
                  className={`p-3 rounded-xl border flex flex-col gap-2.5 ${
                    bk.status === 'aktif'
                      ? 'bg-slate-50 border-slate-200'
                      : 'bg-slate-50/50 border-slate-200 opacity-65'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-xs font-bold text-blue-700">{bk.kodeBooking}</span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                          {bk.busNama}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            bk.status === 'aktif'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          {bk.status === 'aktif' ? 'Aktif' : 'Dibatalkan'}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-900 mt-1">{bk.namaPemesan}</p>
                      <p className="text-[11px] text-slate-500">
                        {bk.mode === 'suami_istri' ? 'Suami & Istri' : 'Sendiri'} •{' '}
                        {formatWhatsAppDisplay(bk.noWhatsapp)}
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-blue-100 text-blue-800 text-xs font-extrabold shrink-0">
                      {bk.seats.map((s) => s.label).join(' & ')}
                    </span>
                  </div>

                  {bk.status === 'aktif' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveTicket(bk)}
                        className="flex-1 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                      >
                        Lihat E-Tiket
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartChangeSeat(bk)}
                        className="px-3 h-9 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold"
                      >
                        Ubah
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Secondary WhatsApp Lookup */}
          <details className="pt-2 border-t border-slate-100">
            <summary className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer select-none">
              Atau cari pesanan dengan Nomor WhatsApp
            </summary>
            <div className="mt-3 space-y-2.5">
              <form onSubmit={handleLookupSearch} className="flex gap-2">
                <input
                  ref={lookupInputRef}
                  type="tel"
                  value={lookupWa}
                  onChange={(e) => setLookupWa(e.target.value)}
                  placeholder="0812-XXXX-XXXX"
                  className="flex-1 h-10 px-3.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs placeholder:text-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
                <button
                  type="submit"
                  disabled={lookupLoading}
                  className="px-4 h-10 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 text-xs font-bold transition-colors shrink-0 disabled:opacity-60"
                >
                  {lookupLoading ? 'Mencari...' : 'Cari'}
                </button>
              </form>

          {lookupError && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {lookupError}
            </div>
          )}

          {lookupResults !== null && (
            <div className="space-y-2.5 pt-1">
              {lookupResults.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 text-center">
                  Tidak ada pesanan aktif ditemukan untuk nomor WhatsApp tersebut.
                </div>
              ) : (
                lookupResults.map((bk) => (
                  <div
                    key={bk.id}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col gap-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-blue-700">{bk.kodeBooking}</span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                            {bk.busNama}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-800 mt-1">{bk.maskedName}</p>
                        <p className="text-[11px] text-slate-500">
                          {bk.mode === 'suami_istri' ? 'Suami & Istri' : 'Sendiri'} • WA: {bk.noWhatsappMasked}
                        </p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-blue-100 text-blue-800 text-xs font-extrabold">
                        {bk.seats.map((s) => s.label).join(' & ')}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenTicketFromLookup(bk.kodeBooking)}
                        className="flex-1 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                      >
                        Lihat E-Tiket
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await publicApi.getTicket(bk.kodeBooking, lookupWa);
                          await handleStartChangeSeat(res.booking, lookupWa);
                        }}
                        className="px-3 h-9 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold"
                      >
                        Ubah
                      </button>
                      <button
                        type="button"
                        onClick={() => setCancelTarget(bk)}
                        className="px-3 h-9 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 text-xs font-semibold"
                      >
                        Batalkan
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
            </div>
          </details>
        </section>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 w-full z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/90 dark:border-slate-800 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('kursi');
              mapSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            className={`flex flex-col items-center justify-center flex-1 h-12 gap-0.5 ${
              activeTab === 'kursi' ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">airline_seat_recline_extra</span>
            <span className="text-[11px]">Kursi</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('jadwal');
              setInfoModal('jadwal');
            }}
            className={`flex flex-col items-center justify-center flex-1 h-12 gap-0.5 ${
              activeTab === 'jadwal' ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">schedule</span>
            <span className="text-[11px]">Jadwal</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('tiket');
              lookupSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
              setTimeout(() => lookupInputRef.current?.focus(), 350);
            }}
            className={`flex flex-col items-center justify-center flex-1 h-12 gap-0.5 ${
              activeTab === 'tiket' ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">confirmation_number</span>
            <span className="text-[11px]">Tiket</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('event');
              setInfoModal('event');
            }}
            className={`flex flex-col items-center justify-center flex-1 h-12 gap-0.5 ${
              activeTab === 'event' ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">stadium</span>
            <span className="text-[11px]">Event</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('profil');
              if (participant) {
                setProfileModalOpen(true);
              } else {
                setAuthError(null);
                setAuthTab('login');
                setAuthModalOpen(true);
              }
            }}
            className={`flex flex-col items-center justify-center flex-1 h-12 gap-0.5 ${
              activeTab === 'profil' ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">account_circle</span>
            <span className="text-[11px]">Profil</span>
          </button>
        </div>
      </nav>

      {/* Info Modal (Jadwal / Event) */}
      {infoModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                  {infoModal === 'jadwal' ? 'Jadwal Keberangkatan' : 'Informasi Event'}
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-0.5">{event.nama}</h3>
              </div>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-blue-600 text-[18px]">calendar_today</span>
                <div>
                  <div className="font-bold text-slate-900">
                    {event.tanggal} • {event.jamBerangkat}
                  </div>
                  <div className="text-slate-500">Harap hadir 30 menit sebelum keberangkatan</div>
                </div>
              </div>
              <div className="flex items-start gap-2 pt-2 border-t border-slate-200">
                <span className="material-symbols-outlined text-emerald-600 text-[18px]">location_on</span>
                <div>
                  <div className="font-bold text-slate-900">{event.lokasiBerangkat}</div>
                  {event.titikKumpulDetail && (
                    <div className="text-slate-500">{event.titikKumpulDetail}</div>
                  )}
                </div>
              </div>
              {event.deskripsi && (
                <p className="pt-2 border-t border-slate-200 leading-relaxed text-slate-600">
                  {event.deskripsi}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setInfoModal(null);
                  onNavigateAdmin();
                }}
                className="px-3.5 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">admin_panel_settings</span>
                <span>Halaman Admin</span>
              </button>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                className="px-5 h-10 rounded-xl bg-blue-600 text-white text-xs font-bold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Participant Login / Register Modal (Email Only, No Password) */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                  Akun Peserta • Tanpa Password
                </span>
                <h3 className="text-base font-extrabold text-slate-900 mt-0.5">
                  {authTab === 'login' ? 'Masuk dengan Email' : 'Daftar Akun Peserta'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAuthModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl gap-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('login');
                  setAuthError(null);
                }}
                className={`py-2 rounded-lg font-bold transition-all ${
                  authTab === 'login' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600'
                }`}
              >
                Masuk (Login)
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthTab('register');
                  setAuthError(null);
                }}
                className={`py-2 rounded-lg font-bold transition-all ${
                  authTab === 'register' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600'
                }`}
              >
                Daftar (Register)
              </button>
            </div>

            {authTab === 'login' ? (
              <form onSubmit={handleAuthLogin} className="space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700" htmlFor="auth-login-email">
                    Alamat Email
                  </label>
                  <input
                    id="auth-login-email"
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="nama@email.com"
                    className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-300 text-sm focus:outline-none focus:border-blue-600 focus:bg-white"
                  />
                </div>
                {authError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 space-y-1">
                    <div>{authError}</div>
                    {authError.includes('belum terdaftar') && (
                      <button
                        type="button"
                        onClick={() => {
                          setAuthTab('register');
                          setAuthError(null);
                        }}
                        className="font-bold underline text-blue-700"
                      >
                        Daftar sekarang dengan email ini →
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm disabled:opacity-60"
                >
                  {authLoading ? 'Memproses...' : 'Masuk Sekarang'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleAuthRegister} className="space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700" htmlFor="auth-reg-email">
                    Alamat Email <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="auth-reg-email"
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="nama@email.com"
                    className="w-full h-10 px-3.5 rounded-xl bg-slate-50 border border-slate-300 text-sm focus:outline-none focus:border-blue-600 focus:bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700" htmlFor="auth-reg-nama">
                    Nama Lengkap <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="auth-reg-nama"
                    type="text"
                    required
                    value={authNama}
                    onChange={(e) => setAuthNama(e.target.value)}
                    placeholder="cth. Siti Fatimah"
                    className="w-full h-10 px-3.5 rounded-xl bg-slate-50 border border-slate-300 text-sm focus:outline-none focus:border-blue-600 focus:bg-white"
                  />
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Daftar cukup dengan Email &amp; Nama. Setelah masuk, Anda langsung
                  bisa memilih dan memesan kursi.
                </p>
                {authError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700">
                    {authError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm disabled:opacity-60"
                >
                  {authLoading ? 'Mendaftar...' : 'Daftar & Masuk'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Participant Profile Modal */}
      {profileModalOpen && participant && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setProfileModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <span className="material-symbols-outlined text-[20px]">account_circle</span>
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Profil Saya</h3>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                aria-label="Tutup profil"
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Nama</div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5 break-words">
                  {participant.nama}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Email</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5 break-all">
                  {participant.email}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="flex-1 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={handleAuthLogout}
                className="flex-1 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                <span>Keluar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Lookup Confirmation Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Batalkan Pesanan {cancelTarget.kodeBooking}?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              {cancelTarget.mode === 'suami_istri'
                ? `Membatalkan pesanan Suami & Istri ini akan melepas kedua kursi (${cancelTarget.seats
                    .map((s) => s.label)
                    .join(' & ')}) secara bersamaan.`
                : `Kursi ${cancelTarget.seats.map((s) => s.label).join(', ')} akan dilepas dan tersedia kembali.`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="flex-1 h-10 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmLookupCancel}
                className="flex-1 h-10 rounded-xl bg-rose-600 text-white text-xs font-bold"
              >
                Ya, Batalkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
