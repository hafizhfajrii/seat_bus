import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminRole,
  AdminSeat,
  AdminUser,
  AuditLogEntry,
  BookingDetail,
  BookingMode,
  BusInfo,
  CoupleRole,
  DashboardSummary,
  EventInfo,
  Gender,
  RegisteredPhone,
} from '../../shared/types';
import { formatWhatsAppDisplay } from '../../shared/seatRules';
import { adminApi } from '../api';
import { ThemeToggleButton, type ThemeMode } from '../theme';
import { BusSeatMap } from './BusSeatMap';

interface AdminViewProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onNavigateParticipant: () => void;
}

type AdminSection = 'dashboard' | 'denah' | 'manifest' | 'phones' | 'settings' | 'audit';

interface CurrentAdmin {
  id: number;
  nama: string;
  email: string;
  role: AdminRole;
}

export const AdminView: React.FC<AdminViewProps> = ({
  theme,
  onToggleTheme,
  onNavigateParticipant,
}) => {
  const [authChecked, setAuthChecked] = useState(false);
  const [currentAdmin, setCurrentAdmin] = useState<CurrentAdmin | null>(null);

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Portal state
  const [section, setSection] = useState<AdminSection>('denah');
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [buses, setBuses] = useState<BusInfo[]>([]);
  const [activeBusId, setActiveBusId] = useState<number | null>(null);
  const [seats, setSeats] = useState<AdminSeat[]>([]);
  const [bookings, setBookings] = useState<BookingDetail[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);

  // Feedback
  const [toast, setToast] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Seat Inspector state
  const [selectedSeatLabel, setSelectedSeatLabel] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState('Cadangan Panitia');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMode, setManualMode] = useState<BookingMode>('sendiri');
  const [manualGender, setManualGender] = useState<Gender>('L');
  const [manualName, setManualName] = useState('');
  const [manualWifeName, setManualWifeName] = useState('');
  const [manualWa, setManualWa] = useState('');
  const [manualSecondSeat, setManualSecondSeat] = useState('');
  const [manualFirstRole, setManualFirstRole] = useState<CoupleRole>('suami');
  const [manualOverride, setManualOverride] = useState(false);
  const [manualOverrideReason, setManualOverrideReason] = useState('');

  // Move Seat modal state
  const [moveTargetBooking, setMoveTargetBooking] = useState<BookingDetail | null>(null);
  const [moveBusId, setMoveBusId] = useState<number>(1);
  const [moveSeat1, setMoveSeat1] = useState('');
  const [moveSeat2, setMoveSeat2] = useState('');
  const [moveOverride, setMoveOverride] = useState(false);
  const [moveOverrideReason, setMoveOverrideReason] = useState('');

  // Manifest filters
  const [searchQuery, setSearchQuery] = useState('');
  const [manifestFilter, setManifestFilter] = useState<'semua' | 'L' | 'P' | 'pasangan' | 'dibatalkan'>('semua');
  const [manifestBusFilter, setManifestBusFilter] = useState<number | 'all'>('all');

  // Event & Bus forms
  const [eventDraft, setEventDraft] = useState<Partial<EventInfo>>({});
  const [newBusNama, setNewBusNama] = useState('');
  const [newBusPlat, setNewBusPlat] = useState('');
  const [newBusTipe, setNewBusTipe] = useState('Executive Coach');
  const [newBusSopir, setNewBusSopir] = useState<'kanan' | 'kiri'>('kanan');

  // New Admin user form (Super Admin)
  const [newUserNama, setNewUserNama] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserRole, setNewUserRole] = useState<AdminRole>('admin');

  // Registered participant WhatsApp whitelist
  const [registeredPhones, setRegisteredPhones] = useState<RegisteredPhone[]>([]);
  const [singlePhoneInput, setSinglePhoneInput] = useState('');
  const [singlePhoneNote, setSinglePhoneNote] = useState('');
  const [bulkPhoneText, setBulkPhoneText] = useState('');
  const [phoneSearch, setPhoneSearch] = useState('');

  const notify = (type: 'error' | 'success', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 5000);
  };

  const loadAdminData = useCallback(
    async (preferredBusId?: number) => {
      try {
        const [dash, bks, logs, phs] = await Promise.all([
          adminApi.getDashboard(),
          adminApi.listBookings(),
          adminApi.getAuditLogs(),
          adminApi.listPhones(),
        ]);
        setEvent(dash.event);
        setEventDraft(dash.event);
        setSummary(dash.summary);
        setBuses(dash.buses);
        setBookings(bks.bookings);
        setAuditLogs(logs.logs);
        setRegisteredPhones(phs.phones);

        const targetBus =
          preferredBusId && dash.buses.some((b) => b.id === preferredBusId)
            ? preferredBusId
            : activeBusId && dash.buses.some((b) => b.id === activeBusId)
            ? activeBusId
            : dash.buses[0]?.id ?? null;

        if (targetBus) {
          setActiveBusId(targetBus);
          const seatData = await adminApi.getBusSeats(targetBus);
          setSeats(seatData.seats);
        }
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Gagal memuat data admin.');
      }
    },
    [activeBusId]
  );

  const loadSuperAdminUsers = useCallback(async (role: AdminRole) => {
    if (role !== 'super_admin') return;
    try {
      const res = await adminApi.listUsers();
      setAdminUsers(res.users);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    adminApi
      .me()
      .then((res) => {
        setCurrentAdmin(res.admin);
        loadAdminData();
        loadSuperAdminUsers(res.admin.role);
      })
      .catch(() => {
        setCurrentAdmin(null);
      })
      .finally(() => setAuthChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time SSE + fallback polling sync for admin
  useEffect(() => {
    if (!currentAdmin) return;
    const es = new EventSource('/api/stream');
    es.addEventListener('seat-update', () => {
      loadAdminData(activeBusId ?? undefined);
    });
    es.onerror = () => {
      es.close();
    };
    const timer = setInterval(() => {
      loadAdminData(activeBusId ?? undefined);
    }, 10000);
    return () => {
      es.close();
      clearInterval(timer);
    };
  }, [currentAdmin, activeBusId, loadAdminData]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await adminApi.login(loginEmail, loginPassword);
      setCurrentAdmin(res.admin);
      await loadAdminData();
      await loadSuperAdminUsers(res.admin.role);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login gagal.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await adminApi.logout();
    setCurrentAdmin(null);
  };

  const activeBus = useMemo(
    () => buses.find((b) => b.id === activeBusId) ?? buses[0] ?? null,
    [buses, activeBusId]
  );

  const inspectedSeat = useMemo(
    () => seats.find((s) => s.label === selectedSeatLabel) ?? null,
    [seats, selectedSeatLabel]
  );

  const handleSwitchBus = async (busId: number) => {
    setActiveBusId(busId);
    setSelectedSeatLabel(null);
    setManualOpen(false);
    const seatData = await adminApi.getBusSeats(busId);
    setSeats(seatData.seats);
  };

  const handleBlockToggle = async (seat: AdminSeat, block: boolean) => {
    try {
      await adminApi.toggleBlockSeat(seat.id, block, blockReason);
      notify('success', block ? `Kursi ${seat.label} diblokir.` : `Kunci kursi ${seat.label} dibuka.`);
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal mengubah status kunci kursi.');
    }
  };

  const handleManualBookSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBus || !inspectedSeat) return;

    try {
      const seatsPayload =
        manualMode === 'sendiri'
          ? [{ label: inspectedSeat.label }]
          : [
              { label: inspectedSeat.label, role: manualFirstRole },
              {
                label: manualSecondSeat,
                role: (manualFirstRole === 'suami' ? 'istri' : 'suami') as CoupleRole,
              },
            ];

      await adminApi.manualBook({
        busId: activeBus.id,
        mode: manualMode,
        namaPemesan: manualName,
        namaIstri: manualMode === 'suami_istri' ? manualWifeName : undefined,
        gender: manualMode === 'sendiri' ? manualGender : undefined,
        noWhatsapp: manualWa,
        seats: seatsPayload,
        override: manualOverride,
        overrideReason: manualOverrideReason,
      });

      setManualOpen(false);
      setManualName('');
      setManualWifeName('');
      setManualWa('');
      setManualOverride(false);
      setManualOverrideReason('');
      notify('success', `Kursi ${inspectedSeat.label} berhasil diisi secara manual.`);
      await loadAdminData(activeBus.id);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal mengisi kursi manual.');
    }
  };

  const openMoveModal = (booking: BookingDetail) => {
    setMoveTargetBooking(booking);
    setMoveBusId(booking.busId);
    setMoveSeat1(booking.seats[0]?.label ?? '');
    setMoveSeat2(booking.seats[1]?.label ?? '');
    setMoveOverride(false);
    setMoveOverrideReason('');
  };

  const handleMoveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveTargetBooking) return;
    try {
      const seatsPayload =
        moveTargetBooking.mode === 'sendiri'
          ? [{ label: moveSeat1.trim().toUpperCase() }]
          : [
              { label: moveSeat1.trim().toUpperCase(), role: 'suami' as CoupleRole },
              { label: moveSeat2.trim().toUpperCase(), role: 'istri' as CoupleRole },
            ];
      await adminApi.moveBookingSeats(moveTargetBooking.id, {
        busId: moveBusId,
        seats: seatsPayload,
        override: moveOverride,
        overrideReason: moveOverrideReason,
      });
      setMoveTargetBooking(null);
      notify('success', `Pesanan ${moveTargetBooking.kodeBooking} berhasil dipindahkan.`);
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal memindahkan kursi.');
    }
  };

  const handleAdminCancelBooking = async (bookingId: number, kode: string) => {
    if (!window.confirm(`Lepas dan batalkan pesanan ${kode}? Status pesanan akan menjadi Dibatalkan.`)) {
      return;
    }
    try {
      await adminApi.cancelBooking(bookingId, 'Dilepas oleh Admin');
      notify('success', `Pesanan ${kode} dibatalkan dan kursi dilepas kembali.`);
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal membatalkan pesanan.');
    }
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminApi.updateEvent(eventDraft);
      notify('success', 'Pengaturan event berhasil disimpan.');
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal menyimpan event.');
    }
  };

  const handleAddBus = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await adminApi.createBus({
        nama: newBusNama,
        platNomor: newBusPlat,
        tipeArmada: newBusTipe,
        posisiSopir: newBusSopir,
      });
      setNewBusNama('');
      setNewBusPlat('');
      notify('success', `Armada ${newBusNama} dengan 38 kursi berhasil ditambahkan.`);
      await loadAdminData(res.busId);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal menambah bus.');
    }
  };

  const handleToggleBusActive = async (bus: BusInfo) => {
    try {
      await adminApi.updateBus(bus.id, { aktif: !bus.aktif });
      notify('success', `${bus.nama} ${!bus.aktif ? 'diaktifkan' : 'dinonaktifkan'}.`);
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal memperbarui bus.');
    }
  };

  const handleToggleBusDriverSide = async (bus: BusInfo) => {
    const nextSide = bus.posisiSopir === 'kanan' ? 'kiri' : 'kanan';
    try {
      await adminApi.updateBus(bus.id, { posisiSopir: nextSide });
      notify('success', `Posisi sopir ${bus.nama} diubah ke ${nextSide.toUpperCase()}.`);
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal memperbarui posisi sopir.');
    }
  };

  const handleCreateAdminUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminApi.createUser({
        nama: newUserNama,
        email: newUserEmail,
        password: newUserPass,
        role: newUserRole,
      });
      setNewUserNama('');
      setNewUserEmail('');
      setNewUserPass('');
      notify('success', 'Akun admin baru berhasil dibuat.');
      if (currentAdmin) await loadSuperAdminUsers(currentAdmin.role);
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal membuat akun admin.');
    }
  };

  const handleDeleteAdminUser = async (id: number) => {
    if (!window.confirm('Hapus akun admin ini?')) return;
    try {
      await adminApi.deleteUser(id);
      notify('success', 'Akun admin dihapus.');
      if (currentAdmin) await loadSuperAdminUsers(currentAdmin.role);
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal menghapus akun.');
    }
  };

  const handleAddSinglePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await adminApi.addPhones([{ noWhatsapp: singlePhoneInput, catatan: singlePhoneNote }]);
      if (res.invalid.length > 0) {
        notify('error', `Nomor tidak valid: ${res.invalid.join(', ')}`);
        return;
      }
      setSinglePhoneInput('');
      setSinglePhoneNote('');
      notify('success', 'Nomor WhatsApp berhasil didaftarkan.');
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal mendaftarkan nomor.');
    }
  };

  const parseBulkPhoneEntries = useCallback((rawText: string) => {
    const entries: Array<{ noWhatsapp: string; catatan?: string }> = [];
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const looksLikePhone = (str: string) => {
      const digits = str.replace(/\D/g, '');
      return digits.length >= 9 && digits.length <= 15 && !/[a-zA-Z]{2,}/.test(str);
    };

    for (const line of lines) {
      const parts = line
        .split(/[,;\t|]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) continue;

      // Case 1: Multiple phone numbers on the same line (e.g. "0812..., 0856..., 0813...")
      if (parts.length >= 2 && parts.every(looksLikePhone)) {
        for (const p of parts) {
          entries.push({ noWhatsapp: p, catatan: '' });
        }
        continue;
      }

      // Case 2: Phone + Name/Note in either order (e.g. Excel 2 columns)
      const phoneIdx = parts.findIndex(looksLikePhone);
      if (phoneIdx !== -1) {
        const phone = parts[phoneIdx];
        const note = parts.filter((_, idx) => idx !== phoneIdx).join(' ').trim();
        entries.push({ noWhatsapp: phone, catatan: note });
      } else {
        entries.push({ noWhatsapp: parts[0], catatan: parts.slice(1).join(' ').trim() });
      }
    }
    return entries;
  }, []);

  const parsedBulkPreview = useMemo(
    () => parseBulkPhoneEntries(bulkPhoneText),
    [bulkPhoneText, parseBulkPhoneEntries]
  );

  const handleBulkPhones = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedBulkPreview.length === 0) return;

    try {
      const res = await adminApi.addPhones(parsedBulkPreview);
      setBulkPhoneText('');
      if (res.invalid.length > 0) {
        notify(
          'success',
          `${res.added} nomor berhasil didaftarkan. ${res.invalid.length} baris dilewati karena format tidak valid (${res.invalid.slice(0, 3).join(', ')}).`
        );
      } else {
        notify('success', `${res.added} nomor WhatsApp berhasil didaftarkan.`);
      }
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal import nomor.');
    }
  };

  const handleBulkFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBulkPhoneText((prev) => (prev ? `${prev}\n${text}` : text));
    e.target.value = '';
  };

  const handleDeletePhone = async (id: number, phone: string) => {
    if (!window.confirm(`Hapus nomor ${formatWhatsAppDisplay(phone)} dari daftar terdaftar?`)) return;
    try {
      await adminApi.deletePhone(id);
      notify('success', 'Nomor dihapus dari daftar peserta terdaftar.');
      await loadAdminData(activeBusId ?? undefined);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Gagal menghapus nomor.');
    }
  };

  const filteredPhones = useMemo(() => {
    const q = phoneSearch.trim().toLowerCase();
    if (!q) return registeredPhones;
    return registeredPhones.filter(
      (p) =>
        p.noWhatsapp.includes(q) ||
        formatWhatsAppDisplay(p.noWhatsapp).includes(q) ||
        p.catatan.toLowerCase().includes(q)
    );
  }, [registeredPhones, phoneSearch]);

  const filteredBookings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bookings.filter((b) => {
      if (manifestBusFilter !== 'all' && b.busId !== manifestBusFilter) return false;
      if (manifestFilter === 'dibatalkan') {
        if (b.status !== 'dibatalkan') return false;
      } else {
        if (b.status !== 'aktif') return false;
        if (manifestFilter === 'L' && (b.mode !== 'sendiri' || b.seats[0]?.jenisKelamin !== 'L')) return false;
        if (manifestFilter === 'P' && (b.mode !== 'sendiri' || b.seats[0]?.jenisKelamin !== 'P')) return false;
        if (manifestFilter === 'pasangan' && b.mode !== 'suami_istri') return false;
      }
      if (!q) return true;
      const haystack = [
        b.kodeBooking,
        b.namaPemesan,
        b.noWhatsapp,
        b.busNama,
        ...b.seats.map((s) => `${s.label} ${s.namaPenumpang}`),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [bookings, searchQuery, manifestFilter, manifestBusFilter]);

  // Flat sorted manifest rows for print/view
  const sortedManifestRows = useMemo(() => {
    const rows: Array<{
      seatLabel: string;
      busNama: string;
      namaPenumpang: string;
      gender: Gender;
      modeLabel: string;
      wa: string;
      kode: string;
    }> = [];
    for (const b of bookings) {
      if (b.status !== 'aktif') continue;
      if (manifestBusFilter !== 'all' && b.busId !== manifestBusFilter) continue;
      for (const s of b.seats) {
        rows.push({
          seatLabel: s.label,
          busNama: b.busNama,
          namaPenumpang: s.namaPenumpang,
          gender: s.jenisKelamin,
          modeLabel: b.mode === 'suami_istri' ? `Pasangan (${s.peranPasangan ?? '-'})` : 'Sendiri',
          wa: formatWhatsAppDisplay(b.noWhatsapp),
          kode: b.kodeBooking,
        });
      }
    }
    const rank = (lbl: string) =>
      lbl.startsWith('R') ? 9900 + Number(lbl.slice(1)) : lbl.charCodeAt(0) * 10 + Number(lbl.slice(1));
    return rows.sort((a, b) => a.busNama.localeCompare(b.busNama) || rank(a.seatLabel) - rank(b.seatLabel));
  }, [bookings, manifestBusFilter]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <span className="material-symbols-outlined text-4xl text-blue-600 animate-spin">progress_activity</span>
      </div>
    );
  }

  // LOGIN SCREEN
  if (!currentAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-lg p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
                <span className="material-symbols-outlined text-[22px]">admin_panel_settings</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                  Admin Fleet &amp; Transit
                </span>
                <h1 className="text-base font-extrabold text-slate-900 leading-tight">Login Panitia</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggleButton theme={theme} onToggle={onToggleTheme} compact />
              <button
                type="button"
                onClick={onNavigateParticipant}
                className="text-xs font-semibold text-slate-500 hover:text-blue-600 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                <span>Peserta</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-3.5">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700" htmlFor="admin-email">
                Email Admin
              </label>
              <input
                id="admin-email"
                type="text"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="admin atau nama@email.com"
                className="h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-300 text-sm focus:outline-none focus:border-blue-600 focus:bg-white"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-700" htmlFor="admin-pass">
                Kata Sandi
              </label>
              <input
                id="admin-pass"
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-300 text-sm focus:outline-none focus:border-blue-600 focus:bg-white"
              />
            </div>

            {loginError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-sm disabled:opacity-60"
            >
              {loginLoading ? 'Memverifikasi...' : 'Masuk Dashboard Admin'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: AdminSection; label: string; icon: string }> = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'denah', label: 'Denah & Kursi', icon: 'airline_seat_recline_extra' },
    { id: 'manifest', label: 'Manifest', icon: 'assignment' },
    { id: 'phones', label: 'Nomor Peserta', icon: 'contact_phone' },
    { id: 'settings', label: 'Event & Bus', icon: 'tune' },
    { id: 'audit', label: 'Akun & Log', icon: 'history' },
  ];

  const isSuperAdmin = currentAdmin.role === 'super_admin';

  return (
    <div className="min-h-screen bg-[#faf8ff] text-slate-900 flex flex-col md:flex-row">
      {/* Desktop / Tablet Sidebar */}
      <aside className="no-print hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="p-4 border-b border-slate-200 flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined">directions_bus</span>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
              Admin Fleet &amp; Transit
            </div>
            <div className="text-sm font-extrabold text-slate-900 truncate">
              {event?.nama ?? 'Transit Event'}
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                section === item.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="material-symbols-outlined text-[19px]">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-200 space-y-2">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-xs font-bold text-slate-900 truncate">{currentAdmin.nama}</div>
            <div className="text-[11px] text-slate-500 truncate">{currentAdmin.email}</div>
            <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-extrabold uppercase">
              {isSuperAdmin ? 'Super Admin' : 'Admin'}
            </span>
          </div>
          <div className="flex gap-2">
            <ThemeToggleButton theme={theme} onToggle={onToggleTheme} compact />
            <button
              type="button"
              onClick={onNavigateParticipant}
              className="flex-1 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
            >
              Lihat Publik
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 h-9 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold"
            >
              Keluar
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="no-print md:hidden sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNavigateParticipant}
            className="w-9 h-9 rounded-full flex items-center justify-center text-slate-700 hover:bg-slate-100"
          >
            <span className="material-symbols-outlined text-[21px]">arrow_back</span>
          </button>
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-blue-600 block">
              {isSuperAdmin ? 'Super Admin' : 'Admin Panitia'}
            </span>
            <h1 className="text-sm font-bold text-slate-900 leading-tight">
              Kelola Penumpang &amp; Kursi
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <ThemeToggleButton theme={theme} onToggle={onToggleTheme} compact />
          <button
            type="button"
            onClick={handleLogout}
            className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-xs font-bold"
          >
            Keluar
          </button>
        </div>
      </header>

      {/* Mobile Bottom / Top Tabs */}
      <div className="no-print md:hidden bg-white border-b border-slate-200 px-2 py-1.5 flex gap-1 overflow-x-auto no-scrollbar">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold ${
              section === item.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1 md:pl-64 min-w-0">
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
          {/* Operational Status Banner */}
          {event && (
            <div className="no-print flex items-center justify-between bg-indigo-50/80 border border-indigo-100 px-4 py-2.5 rounded-xl flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse" />
                <span className="text-xs font-bold text-slate-800">Mode Penata Operasional Aktif</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                    event.statusPendaftaran === 'buka'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {event.statusPendaftaran === 'buka' ? 'Registrasi Terbuka' : 'Registrasi Ditutup'}
                </span>
                <button
                  type="button"
                  onClick={() => loadAdminData(activeBusId ?? undefined)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-slate-200 text-blue-700 text-[11px] font-bold hover:bg-blue-50"
                >
                  <span className="material-symbols-outlined text-[14px]">refresh</span>
                  <span>Sinkron</span>
                </button>
              </div>
            </div>
          )}

          {toast && (
            <div
              className={`no-print p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2 shadow-sm ${
                toast.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              <span>{toast.text}</span>
              <button type="button" onClick={() => setToast(null)}>
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          )}

          {/* SECTION 1: DASHBOARD */}
          {section === 'dashboard' && summary && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
                  <span className="text-xs text-slate-500 font-semibold">Total Terisi</span>
                  <div className="text-2xl font-black text-blue-700 mt-1">
                    {summary.totalOccupied}
                    <span className="text-sm font-semibold text-slate-400">/{summary.totalCapacity}</span>
                  </div>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
                  <span className="text-xs text-slate-500 font-semibold">Kursi Kosong</span>
                  <div className="text-2xl font-black text-emerald-600 mt-1">{summary.totalAvailable}</div>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
                  <span className="text-xs text-slate-500 font-semibold">Laki-laki / Perempuan</span>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    <span className="text-sky-700">{summary.maleCount} L</span>
                    <span className="text-slate-300 mx-1.5">/</span>
                    <span className="text-rose-600">{summary.femaleCount} P</span>
                  </div>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
                  <span className="text-xs text-slate-500 font-semibold">Pasangan Suami-Istri</span>
                  <div className="text-2xl font-black text-indigo-700 mt-1">{summary.coupleCount}</div>
                </div>
              </div>

              {/* Per Bus Occupancy */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                <h2 className="text-sm font-bold text-slate-900">Okupansi per Armada Bus</h2>
                <div className="space-y-3">
                  {summary.buses.map((b) => {
                    const pct = b.total > 0 ? Math.round((b.occupied / b.total) * 100) : 0;
                    return (
                      <div key={b.busId} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span>{b.nama}</span>
                          <span>
                            {b.occupied}/{b.total} Terisi ({b.available} Kosong • {b.blocked} Kunci)
                          </span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Laki-laki: {b.maleCount} • Perempuan: {b.femaleCount}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent Bookings */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                <h2 className="text-sm font-bold text-slate-900">Pemesanan Terbaru</h2>
                <div className="divide-y divide-slate-100">
                  {summary.recentBookings.map((b) => (
                    <div key={b.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div>
                        <div className="font-bold text-slate-900">{b.namaPemesan}</div>
                        <div className="text-slate-500">
                          {b.kodeBooking} • {b.busNama} • {formatWhatsAppDisplay(b.noWhatsapp)}
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-extrabold">
                        {b.seats.map((s) => s.label).join(' & ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: DENAH & SEAT INSPECTOR */}
          {section === 'denah' && activeBus && (
            <div className="space-y-5">
              {/* Bus Tabs */}
              {buses.length > 1 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  {buses.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleSwitchBus(b.id)}
                      className={`px-3.5 py-2 rounded-xl border text-xs font-bold shrink-0 ${
                        b.id === activeBus.id
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      {b.nama} ({b.availableSeats}/{b.totalSeats}) {!b.aktif && '• Nonaktif'}
                    </button>
                  ))}
                </div>
              )}

              {/* Summary Stats Card (matching Stitch UI) */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-blue-700">
                      <span className="material-symbols-outlined text-[24px]">directions_bus</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h2 className="text-sm font-bold text-slate-900">
                          {activeBus.nama} • {activeBus.tipeArmada}
                        </h2>
                        {activeBus.platNomor && (
                          <span className="bg-indigo-50 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded">
                            {activeBus.platNomor}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Sopir: Posisi {activeBus.posisiSopir === 'kanan' ? 'Kanan' : 'Kiri'} • Kapasitas{' '}
                        {activeBus.totalSeats} Kursi
                      </p>
                    </div>
                  </div>
                  <a
                    href={`/api/admin/manifest/export?busId=${activeBus.id}`}
                    className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold"
                  >
                    <span className="material-symbols-outlined text-[17px]">file_download</span>
                    <span>Export CSV</span>
                  </a>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1">
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-500 block">Total</span>
                    <span className="text-lg font-extrabold text-slate-900">{activeBus.totalSeats}</span>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-2 text-center border border-emerald-100">
                    <span className="text-[10px] font-bold text-emerald-700 block">Kosong</span>
                    <span className="text-lg font-extrabold text-emerald-700">{activeBus.availableSeats}</span>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-2 text-center border border-blue-100">
                    <span className="text-[10px] font-bold text-blue-700 block">Terisi</span>
                    <span className="text-lg font-extrabold text-blue-700">{activeBus.occupiedSeats}</span>
                  </div>
                  <div className="bg-rose-50 rounded-lg p-2 text-center border border-rose-100">
                    <span className="text-[10px] font-bold text-rose-700 block">Kunci</span>
                    <span className="text-lg font-extrabold text-rose-700">{activeBus.blockedSeats}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Admin Seat Map */}
                <div className="lg:col-span-7 bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Denah &amp; Alokasi Kursi</h3>
                      <p className="text-xs text-slate-500">Sentuh kursi untuk tinjau, blokir, pindah, atau isi manual</p>
                    </div>
                  </div>

                  <BusSeatMap
                    bus={activeBus}
                    seats={seats}
                    viewType="admin"
                    adminSelectedSeatLabel={selectedSeatLabel}
                    onSelectSeat={(seat) => {
                      setSelectedSeatLabel(seat.label);
                      setManualOpen(false);
                      setManualSecondSeat(seat.adjacentLabels[0] ?? '');
                    }}
                  />
                </div>

                {/* Seat Inspector Panel */}
                <div className="lg:col-span-5 bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-4 sticky top-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-sm font-bold text-slate-900">Inspektur Kursi</h3>
                    <span className="material-symbols-outlined text-slate-400 text-[20px]">tune</span>
                  </div>

                  {!inspectedSeat ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      Ketuk salah satu kursi pada denah untuk melihat detail penumpang atau mengelola kursi.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-sm shrink-0 ${
                            inspectedSeat.status === 'diblokir'
                              ? 'bg-slate-200 text-slate-600'
                              : inspectedSeat.status === 'terisi'
                              ? inspectedSeat.occupiedGender === 'P'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-sky-100 text-sky-900'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {inspectedSeat.label}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-slate-900">
                            Kursi {inspectedSeat.label} ({inspectedSeat.tipe === 'leg_rest' ? 'Leg Rest' : 'Belakang'})
                          </h4>
                          <p className="text-xs text-slate-500">{inspectedSeat.posisiDesc}</p>
                        </div>
                      </div>

                      {inspectedSeat.status === 'terisi' && (
                        <div className="space-y-3">
                          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                            <div className="flex justify-between">
                              <span className="text-slate-500">Penumpang:</span>
                              <span className="font-bold text-slate-900">{inspectedSeat.passengerName}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Jenis Kelamin:</span>
                              <span className="font-bold">
                                {inspectedSeat.occupiedGender === 'P' ? 'Perempuan (P)' : 'Laki-laki (L)'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Mode:</span>
                              <span className="font-bold">
                                {inspectedSeat.bookingMode === 'suami_istri'
                                  ? `Pasangan (${inspectedSeat.coupleRole})`
                                  : 'Sendiri'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">No. WhatsApp:</span>
                              <span className="font-mono font-bold">
                                {formatWhatsAppDisplay(inspectedSeat.passengerPhone ?? '')}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Kode Booking:</span>
                              <span className="font-mono font-bold text-blue-700">
                                {inspectedSeat.bookingCode}
                              </span>
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const bk = bookings.find((b) => b.id === inspectedSeat.bookingId);
                                if (bk) openMoveModal(bk);
                              }}
                              className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[16px]">swap_horiz</span>
                              <span>Pindah Seat</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                inspectedSeat.bookingId &&
                                handleAdminCancelBooking(
                                  inspectedSeat.bookingId,
                                  inspectedSeat.bookingCode ?? ''
                                )
                              }
                              className="flex-1 h-10 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold flex items-center justify-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[16px]">person_remove</span>
                              <span>Lepas Kursi</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {inspectedSeat.status === 'diblokir' && (
                        <div className="space-y-3">
                          <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-700">
                            <div className="font-bold text-slate-900">Status: Diblokir Panitia</div>
                            <div className="mt-0.5">Alasan: {inspectedSeat.blockReason}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleBlockToggle(inspectedSeat, false)}
                            className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-[17px]">lock_open</span>
                            <span>Buka Kunci Kursi</span>
                          </button>
                        </div>
                      )}

                      {(inspectedSeat.status === 'tersedia' || inspectedSeat.status === 'ditahan') && (
                        <div className="space-y-3">
                          <div className="space-y-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                            <label className="text-xs font-semibold text-slate-700 block">
                              Alasan Blokir (jika dikunci):
                            </label>
                            <input
                              type="text"
                              value={blockReason}
                              onChange={(e) => setBlockReason(e.target.value)}
                              className="w-full h-9 px-3 rounded-lg bg-white border border-slate-300 text-xs"
                              placeholder="cth. Kursi rusak / Cadangan panitia"
                            />
                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => handleBlockToggle(inspectedSeat, true)}
                                className="flex-1 h-9 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold flex items-center justify-center gap-1"
                              >
                                <span className="material-symbols-outlined text-[16px]">lock</span>
                                <span>Kunci Kursi</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setManualOpen((v) => !v)}
                                className="flex-1 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1"
                              >
                                <span className="material-symbols-outlined text-[16px]">person_add</span>
                                <span>Isi Manual</span>
                              </button>
                            </div>
                          </div>

                          {manualOpen && (
                            <form
                              onSubmit={handleManualBookSubmit}
                              className="p-3 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2.5 text-xs"
                            >
                              <div className="font-bold text-blue-900">
                                Isi Kursi {inspectedSeat.label} Manual
                              </div>

                              <div className="grid grid-cols-2 gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setManualMode('sendiri')}
                                  className={`h-8 rounded-lg font-bold ${
                                    manualMode === 'sendiri'
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-white text-slate-700 border border-slate-200'
                                  }`}
                                >
                                  Sendiri
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setManualMode('suami_istri')}
                                  className={`h-8 rounded-lg font-bold ${
                                    manualMode === 'suami_istri'
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-white text-slate-700 border border-slate-200'
                                  }`}
                                >
                                  Suami &amp; Istri
                                </button>
                              </div>

                              {manualMode === 'sendiri' ? (
                                <div className="grid grid-cols-2 gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setManualGender('L')}
                                    className={`h-8 rounded-lg font-bold ${
                                      manualGender === 'L'
                                        ? 'bg-sky-600 text-white'
                                        : 'bg-white text-slate-700 border border-slate-200'
                                    }`}
                                  >
                                    Laki-laki (L)
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setManualGender('P')}
                                    className={`h-8 rounded-lg font-bold ${
                                      manualGender === 'P'
                                        ? 'bg-rose-600 text-white'
                                        : 'bg-white text-slate-700 border border-slate-200'
                                    }`}
                                  >
                                    Perempuan (P)
                                  </button>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex gap-2 items-center">
                                    <span className="text-[11px] font-semibold">Kursi ke-2:</span>
                                    <select
                                      value={manualSecondSeat}
                                      onChange={(e) => setManualSecondSeat(e.target.value)}
                                      className="flex-1 h-8 px-2 rounded-lg bg-white border border-slate-300 text-xs"
                                    >
                                      {inspectedSeat.adjacentLabels.map((lbl) => (
                                        <option key={lbl} value={lbl}>
                                          {lbl}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="flex gap-2 items-center">
                                    <span className="text-[11px] font-semibold">
                                      Peran di {inspectedSeat.label}:
                                    </span>
                                    <select
                                      value={manualFirstRole}
                                      onChange={(e) => setManualFirstRole(e.target.value as CoupleRole)}
                                      className="flex-1 h-8 px-2 rounded-lg bg-white border border-slate-300 text-xs"
                                    >
                                      <option value="suami">Suami</option>
                                      <option value="istri">Istri</option>
                                    </select>
                                  </div>
                                </div>
                              )}

                              <input
                                type="text"
                                required
                                value={manualName}
                                onChange={(e) => setManualName(e.target.value)}
                                placeholder={
                                  manualMode === 'suami_istri' ? 'Nama Suami' : 'Nama Penumpang'
                                }
                                className="w-full h-9 px-3 rounded-lg bg-white border border-slate-300"
                              />
                              {manualMode === 'suami_istri' && (
                                <input
                                  type="text"
                                  required
                                  value={manualWifeName}
                                  onChange={(e) => setManualWifeName(e.target.value)}
                                  placeholder="Nama Istri"
                                  className="w-full h-9 px-3 rounded-lg bg-white border border-slate-300"
                                />
                              )}
                              <input
                                type="tel"
                                required
                                value={manualWa}
                                onChange={(e) => setManualWa(e.target.value)}
                                placeholder="No. WhatsApp (08xx)"
                                className="w-full h-9 px-3 rounded-lg bg-white border border-slate-300"
                              />

                              {isSuperAdmin && (
                                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 space-y-1.5">
                                  <label className="flex items-center gap-2 font-bold text-amber-900 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={manualOverride}
                                      onChange={(e) => setManualOverride(e.target.checked)}
                                    />
                                    <span>Override Aturan Kursi (Super Admin)</span>
                                  </label>
                                  {manualOverride && (
                                    <input
                                      type="text"
                                      required
                                      value={manualOverrideReason}
                                      onChange={(e) => setManualOverrideReason(e.target.value)}
                                      placeholder="Wajib isi alasan pengecualian..."
                                      className="w-full h-8 px-2.5 rounded-lg bg-white border border-amber-300"
                                    />
                                  )}
                                </div>
                              )}

                              <button
                                type="submit"
                                className="w-full h-9 rounded-lg bg-blue-600 text-white font-bold"
                              >
                                Simpan Kursi Manual
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 3: MANIFEST PENUMPANG */}
          {section === 'manifest' && (
            <div className="space-y-4">
              <div className="no-print flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Manifest &amp; Daftar Pemesanan</h2>
                  <p className="text-xs text-slate-500">
                    {bookings.filter((b) => b.status === 'aktif').length} pesanan aktif tercatat
                  </p>
                </div>
                <div className="flex gap-2">
                  <a
                    href={
                      manifestBusFilter === 'all'
                        ? '/api/admin/manifest/export'
                        : `/api/admin/manifest/export?busId=${manifestBusFilter}`
                    }
                    className="px-3 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[17px]">file_download</span>
                    <span>Ekspor CSV / Excel</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[17px]">print</span>
                    <span>Cetak Manifest</span>
                  </button>
                </div>
              </div>

              {/* Search & Filter Controls */}
              <div className="no-print bg-white rounded-2xl p-3.5 border border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-[19px]">
                      search
                    </span>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari nama, kode booking, kursi, atau WhatsApp..."
                      className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:border-blue-600 focus:bg-white"
                    />
                  </div>
                  <select
                    value={manifestBusFilter}
                    onChange={(e) =>
                      setManifestBusFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                    }
                    className="h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold"
                  >
                    <option value="all">Semua Bus</option>
                    {buses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nama}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {[
                    { id: 'semua', label: 'Semua Aktif' },
                    { id: 'L', label: 'Laki-laki' },
                    { id: 'P', label: 'Perempuan' },
                    { id: 'pasangan', label: 'Pasangan' },
                    { id: 'dibatalkan', label: 'Dibatalkan' },
                  ].map((pill) => (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => setManifestFilter(pill.id as typeof manifestFilter)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold shrink-0 ${
                        manifestFilter === pill.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cards List (Interactive) */}
              <div className="no-print grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredBookings.length === 0 ? (
                  <div className="col-span-full bg-white rounded-2xl p-8 text-center text-xs text-slate-500 border border-slate-200">
                    Tidak ada data pemesanan yang cocok dengan filter.
                  </div>
                ) : (
                  filteredBookings.map((b) => {
                    const isCouple = b.mode === 'suami_istri';
                    const isFemale = !isCouple && b.seats[0]?.jenisKelamin === 'P';
                    return (
                      <div
                        key={b.id}
                        className={`bg-white rounded-2xl p-4 border shadow-xs space-y-3 ${
                          b.status === 'dibatalkan' ? 'border-slate-200 opacity-65' : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                                isCouple
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : isFemale
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-sky-100 text-sky-900'
                              }`}
                            >
                              {b.namaPemesan
                                .split(/\s+/)
                                .slice(0, 2)
                                .map((w) => w[0])
                                .join('')
                                .toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="text-sm font-bold text-slate-900 truncate">
                                  {b.namaPemesan}
                                </h4>
                                {!isCouple && (
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                      isFemale
                                        ? 'bg-rose-100 text-rose-800'
                                        : 'bg-sky-100 text-sky-800'
                                    }`}
                                  >
                                    {b.seats[0]?.jenisKelamin}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500">
                                {b.kodeBooking} • {b.busNama} •{' '}
                                {isCouple ? 'Pasangan Suami-Istri' : 'Sendiri'}
                              </p>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="bg-indigo-50 text-blue-700 font-bold text-xs px-2.5 py-1 rounded-lg">
                              {b.seats.map((s) => s.label).join(' & ')}
                            </span>
                            <span className="block text-[10px] text-slate-400 mt-1">
                              {b.status === 'aktif' ? 'Aktif' : 'Dibatalkan'}
                            </span>
                          </div>
                        </div>

                        <div className="bg-slate-50 p-2 rounded-xl flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 text-slate-700 font-mono">
                            <span className="material-symbols-outlined text-[15px] text-emerald-600">
                              chat
                            </span>
                            <span>{formatWhatsAppDisplay(b.noWhatsapp)}</span>
                          </div>
                          <span className="text-[11px] text-slate-500">{b.dibuatPada.slice(0, 16)}</span>
                        </div>

                        {b.status === 'aktif' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openMoveModal(b)}
                              className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[15px]">edit</span>
                              <span>{isCouple ? 'Ubah Gandeng' : 'Ubah Seat'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAdminCancelBooking(b.id, b.kodeBooking)}
                              className="bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[15px]">person_remove</span>
                              <span>Lepas Kursi</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Printable / Ordered Table */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs overflow-x-auto">
                <h3 className="text-sm font-bold text-slate-900 mb-3">
                  Tabel Manifest Urut Kursi ({sortedManifestRows.length} Penumpang)
                </h3>
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3">Bus</th>
                      <th className="py-2 pr-3">Kursi</th>
                      <th className="py-2 pr-3">Nama Penumpang</th>
                      <th className="py-2 pr-3">L/P</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">WhatsApp</th>
                      <th className="py-2">Kode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedManifestRows.map((r, i) => (
                      <tr key={`${r.busNama}-${r.seatLabel}-${i}`}>
                        <td className="py-2 pr-3 font-semibold">{r.busNama}</td>
                        <td className="py-2 pr-3 font-extrabold text-blue-700">{r.seatLabel}</td>
                        <td className="py-2 pr-3 font-semibold text-slate-900">{r.namaPenumpang}</td>
                        <td className="py-2 pr-3">{r.gender}</td>
                        <td className="py-2 pr-3 text-slate-600">{r.modeLabel}</td>
                        <td className="py-2 pr-3 font-mono">{r.wa}</td>
                        <td className="py-2 font-mono text-slate-500">{r.kode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SECTION 3B: NOMOR PESERTA TERDAFTAR (WHITELIST WA) */}
          {section === 'phones' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">Nomor WhatsApp Peserta Terdaftar</h2>
                <p className="text-xs text-slate-500">
                  Hanya peserta dengan nomor WhatsApp yang terdaftar di sini yang dapat memesan kursi setelah
                  login dengan email.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <form
                  onSubmit={handleAddSinglePhone}
                  className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3 text-xs"
                >
                  <h3 className="text-sm font-bold text-slate-900">Tambah 1 Nomor</h3>
                  <div className="space-y-2">
                    <input
                      type="tel"
                      required
                      value={singlePhoneInput}
                      onChange={(e) => setSinglePhoneInput(e.target.value)}
                      placeholder="No. WhatsApp (cth. 081234567890)"
                      className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                    />
                    <input
                      type="text"
                      value={singlePhoneNote}
                      onChange={(e) => setSinglePhoneNote(e.target.value)}
                      placeholder="Nama / Catatan (opsional)"
                      className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
                  >
                    + Daftarkan Nomor
                  </button>
                </form>

                <form
                  onSubmit={handleBulkPhones}
                  className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-900">Masukkan Banyak Nomor Sekaligus</h3>
                    <label className="cursor-pointer px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px]">upload_file</span>
                      <span>Import CSV/TXT</span>
                      <input
                        type="file"
                        accept=".csv,.txt"
                        onChange={handleBulkFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Bisa tempel langsung dari Excel/Sheets, pisahkan per baris atau koma. Format bebas:{' '}
                    <code className="bg-slate-100 px-1 rounded">0812xxx</code>,{' '}
                    <code className="bg-slate-100 px-1 rounded">0812xxx, Budi</code>, atau{' '}
                    <code className="bg-slate-100 px-1 rounded">Budi, 0812xxx</code>.
                  </p>
                  <textarea
                    rows={4}
                    value={bulkPhoneText}
                    onChange={(e) => setBulkPhoneText(e.target.value)}
                    placeholder={'081234567890, Budi Santoso\n085611112222, Siti Aminah\n081399998888'}
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-300 font-mono text-xs"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-500">
                      {parsedBulkPreview.length > 0
                        ? `Terdeteksi ${parsedBulkPreview.length} baris/nomor siap ditambahkan`
                        : 'Tempel daftar nomor di atas atau pilih file CSV/TXT'}
                    </span>
                    <button
                      type="submit"
                      disabled={parsedBulkPreview.length === 0}
                      className="px-4 h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold disabled:opacity-50"
                    >
                      Tambahkan Semua
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900">
                    Daftar Nomor Terdaftar ({registeredPhones.length})
                  </h3>
                  <input
                    type="text"
                    value={phoneSearch}
                    onChange={(e) => setPhoneSearch(e.target.value)}
                    placeholder="Cari nomor atau nama..."
                    className="h-9 px-3 rounded-xl bg-slate-50 border border-slate-200 w-full sm:w-64"
                  />
                </div>

                {filteredPhones.length === 0 ? (
                  <div className="py-6 text-center text-slate-500">
                    Belum ada nomor WhatsApp terdaftar yang cocok.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 pr-3">No. WhatsApp</th>
                          <th className="py-2 pr-3">Nama / Catatan</th>
                          <th className="py-2 pr-3">Status Pemesanan</th>
                          <th className="py-2 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredPhones.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2.5 pr-3 font-mono font-bold text-slate-900">
                              {formatWhatsAppDisplay(p.noWhatsapp)}
                            </td>
                            <td className="py-2.5 pr-3 text-slate-700">{p.catatan || '-'}</td>
                            <td className="py-2.5 pr-3">
                              {p.hasActiveBooking ? (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                  Sudah Pesan Kursi
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold text-[10px]">
                                  Belum Pesan
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => handleDeletePhone(p.id, p.noWhatsapp)}
                                className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[11px]"
                              >
                                Hapus
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 4: PENGATURAN EVENT & BUS */}
          {section === 'settings' && event && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              {/* Event Settings Form */}
              <form
                onSubmit={handleSaveEvent}
                className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3.5 text-xs"
              >
                <h2 className="text-sm font-bold text-slate-900">Pengaturan Event</h2>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Nama Event</label>
                  <input
                    type="text"
                    required
                    value={eventDraft.nama ?? ''}
                    onChange={(e) => setEventDraft({ ...eventDraft, nama: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Tanggal</label>
                    <input
                      type="text"
                      required
                      value={eventDraft.tanggal ?? ''}
                      onChange={(e) => setEventDraft({ ...eventDraft, tanggal: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Jam Berangkat</label>
                    <input
                      type="text"
                      required
                      value={eventDraft.jamBerangkat ?? ''}
                      onChange={(e) => setEventDraft({ ...eventDraft, jamBerangkat: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Lokasi Keberangkatan</label>
                  <input
                    type="text"
                    required
                    value={eventDraft.lokasiBerangkat ?? ''}
                    onChange={(e) => setEventDraft({ ...eventDraft, lokasiBerangkat: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Detail Titik Kumpul</label>
                  <input
                    type="text"
                    value={eventDraft.titikKumpulDetail ?? ''}
                    onChange={(e) => setEventDraft({ ...eventDraft, titikKumpulDetail: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Deskripsi</label>
                  <textarea
                    rows={3}
                    value={eventDraft.deskripsi ?? ''}
                    onChange={(e) => setEventDraft({ ...eventDraft, deskripsi: e.target.value })}
                    className="w-full p-3 rounded-xl bg-slate-50 border border-slate-300"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Status</label>
                    <select
                      value={eventDraft.statusPendaftaran ?? 'buka'}
                      onChange={(e) =>
                        setEventDraft({
                          ...eventDraft,
                          statusPendaftaran: e.target.value as 'buka' | 'tutup',
                        })
                      }
                      className="w-full h-10 px-2 rounded-xl bg-slate-50 border border-slate-300 font-bold"
                    >
                      <option value="buka">Buka</option>
                      <option value="tutup">Tutup</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Maks / WA</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={eventDraft.batasPesananPerWa ?? 1}
                      onChange={(e) =>
                        setEventDraft({ ...eventDraft, batasPesananPerWa: Number(e.target.value) })
                      }
                      className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Hold (detik)</label>
                    <input
                      type="number"
                      min={60}
                      max={1800}
                      value={eventDraft.durasiHoldDetik ?? 300}
                      onChange={(e) =>
                        setEventDraft({ ...eventDraft, durasiHoldDetik: Number(e.target.value) })
                      }
                      className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
                >
                  Simpan Pengaturan Event
                </button>
              </form>

              {/* Bus Management */}
              <div className="space-y-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3 text-xs">
                  <h2 className="text-sm font-bold text-slate-900">Manajemen Armada Bus</h2>
                  <div className="space-y-2.5">
                    {buses.map((b) => (
                      <div
                        key={b.id}
                        className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 flex-wrap"
                      >
                        <div>
                          <div className="font-bold text-slate-900">
                            {b.nama}{' '}
                            <span className="text-slate-500 font-normal">({b.platNomor || 'Tanpa Plat'})</span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {b.tipeArmada} • Sopir: {b.posisiSopir} • {b.availableSeats}/{b.totalSeats} tersedia
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleToggleBusDriverSide(b)}
                            className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 font-semibold"
                          >
                            Sopir {b.posisiSopir === 'kanan' ? '➔ Kiri' : '➔ Kanan'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleBusActive(b)}
                            className={`px-2.5 py-1.5 rounded-lg font-bold ${
                              b.aktif
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {b.aktif ? 'Aktif' : 'Nonaktif'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <form
                  onSubmit={handleAddBus}
                  className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3 text-xs"
                >
                  <h3 className="text-sm font-bold text-slate-900">Tambah Armada Bus Baru (38 Kursi)</h3>
                  <div className="grid grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      required
                      value={newBusNama}
                      onChange={(e) => setNewBusNama(e.target.value)}
                      placeholder="Nama (cth. BUS 2)"
                      className="h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                    />
                    <input
                      type="text"
                      value={newBusPlat}
                      onChange={(e) => setNewBusPlat(e.target.value)}
                      placeholder="Plat Nomor (cth. B 7891 TAA)"
                      className="h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      value={newBusTipe}
                      onChange={(e) => setNewBusTipe(e.target.value)}
                      placeholder="Tipe Armada"
                      className="h-10 px-3 rounded-xl bg-slate-50 border border-slate-300"
                    />
                    <select
                      value={newBusSopir}
                      onChange={(e) => setNewBusSopir(e.target.value as 'kanan' | 'kiri')}
                      className="h-10 px-3 rounded-xl bg-slate-50 border border-slate-300 font-semibold"
                    >
                      <option value="kanan">Sopir di Kanan</option>
                      <option value="kiri">Sopir di Kiri</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
                  >
                    + Tambah Bus (Auto 38 Kursi)
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* SECTION 5: AKUN ADMIN & AUDIT LOG */}
          {section === 'audit' && (
            <div className="space-y-5">
              {isSuperAdmin && (
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4 text-xs">
                  <h2 className="text-sm font-bold text-slate-900">Kelola Akun Admin (Super Admin)</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      {adminUsers.map((u) => (
                        <div
                          key={u.id}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="font-bold text-slate-900">{u.nama}</div>
                            <div className="text-slate-500">
                              {u.email} • <span className="uppercase font-bold">{u.role}</span>
                            </div>
                          </div>
                          {u.id !== currentAdmin.id && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAdminUser(u.id)}
                              className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-bold"
                            >
                              Hapus
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <form
                      onSubmit={handleCreateAdminUser}
                      className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5"
                    >
                      <div className="font-bold text-slate-800">Tambah Akun Admin</div>
                      <input
                        type="text"
                        required
                        value={newUserNama}
                        onChange={(e) => setNewUserNama(e.target.value)}
                        placeholder="Nama Lengkap"
                        className="w-full h-9 px-3 rounded-lg bg-white border border-slate-300"
                      />
                      <input
                        type="email"
                        required
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="Email"
                        className="w-full h-9 px-3 rounded-lg bg-white border border-slate-300"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={newUserPass}
                          onChange={(e) => setNewUserPass(e.target.value)}
                          placeholder="Kata sandi (min 6)"
                          className="h-9 px-3 rounded-lg bg-white border border-slate-300"
                        />
                        <select
                          value={newUserRole}
                          onChange={(e) => setNewUserRole(e.target.value as AdminRole)}
                          className="h-9 px-2 rounded-lg bg-white border border-slate-300 font-semibold"
                        >
                          <option value="admin">Admin</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                      </div>
                      <button
                        type="submit"
                        className="w-full h-9 rounded-lg bg-blue-600 text-white font-bold"
                      >
                        Buat Akun
                      </button>
                    </form>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
                <h2 className="text-sm font-bold text-slate-900">Audit Log Aktivitas Admin</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3">Waktu</th>
                        <th className="py-2 pr-3">Admin</th>
                        <th className="py-2 pr-3">Aksi</th>
                        <th className="py-2 pr-3">Objek</th>
                        <th className="py-2">Detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="py-2 pr-3 font-mono text-slate-500 whitespace-nowrap">{log.waktu}</td>
                          <td className="py-2 pr-3 font-semibold">{log.adminNama}</td>
                          <td className="py-2 pr-3">
                            <span className="px-2 py-0.5 rounded bg-slate-100 font-mono text-[10px] font-bold">
                              {log.aksi}
                            </span>
                          </td>
                          <td className="py-2 pr-3 font-semibold">{log.objek}</td>
                          <td className="py-2 text-slate-600">{log.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Move Seat Modal */}
      {moveTargetBooking && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleMoveSubmit}
            className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 space-y-3.5 text-xs"
          >
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Pindah Kursi ({moveTargetBooking.kodeBooking})
              </h3>
              <p className="text-slate-500 mt-0.5">
                {moveTargetBooking.namaPemesan} • Kursi saat ini:{' '}
                <strong>{moveTargetBooking.seats.map((s) => s.label).join(' & ')}</strong>
              </p>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Bus Tujuan</label>
              <select
                value={moveBusId}
                onChange={(e) => setMoveBusId(Number(e.target.value))}
                className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300 font-semibold"
              >
                {buses
                  .filter((b) => b.aktif)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nama} ({b.availableSeats} kosong)
                    </option>
                  ))}
              </select>
            </div>

            {moveTargetBooking.mode === 'sendiri' ? (
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Label Kursi Baru (cth. D4, R1)</label>
                <input
                  type="text"
                  required
                  value={moveSeat1}
                  onChange={(e) => setMoveSeat1(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300 uppercase font-bold"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Kursi Suami</label>
                  <input
                    type="text"
                    required
                    value={moveSeat1}
                    onChange={(e) => setMoveSeat1(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300 uppercase font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Kursi Istri</label>
                  <input
                    type="text"
                    required
                    value={moveSeat2}
                    onChange={(e) => setMoveSeat2(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-slate-50 border border-slate-300 uppercase font-bold"
                  />
                </div>
              </div>
            )}

            {isSuperAdmin && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1.5">
                <label className="flex items-center gap-2 font-bold text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={moveOverride}
                    onChange={(e) => setMoveOverride(e.target.checked)}
                  />
                  <span>Override Aturan (Super Admin)</span>
                </label>
                {moveOverride && (
                  <input
                    type="text"
                    required
                    value={moveOverrideReason}
                    onChange={(e) => setMoveOverrideReason(e.target.value)}
                    placeholder="Wajib isi alasan pengecualian..."
                    className="w-full h-9 px-3 rounded-lg bg-white border border-amber-300"
                  />
                )}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setMoveTargetBooking(null)}
                className="flex-1 h-10 rounded-xl bg-slate-100 font-semibold text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                className="flex-1 h-10 rounded-xl bg-blue-600 text-white font-bold"
              >
                Pindahkan
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

