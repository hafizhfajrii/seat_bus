import type {
  AdminRole,
  AdminSeat,
  AuditLogEntry,
  BookingDetail,
  BookingMode,
  BusInfo,
  CoupleRole,
  DashboardSummary,
  EventInfo,
  Gender,
  ParticipantUser,
  PublicLookupBooking,
  PublicSeat,
} from '../shared/types';

export function getSessionId(): string {
  const key = 'transit_seat_session_id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = 'sess_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
    sessionStorage.setItem(key, id);
  }
  return id;
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: unknown }).error)
        : 'Permintaan gagal diproses.';
    throw new Error(message);
  }
  return data as T;
}

// Public & Participant API
export const publicApi = {
  authMe: () => apiFetch<{ participant: ParticipantUser | null }>('/api/auth/me'),
  authRegister: (payload: { email: string; nama: string; noWhatsapp?: string }) =>
    apiFetch<{ participant: ParticipantUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  authLogin: (email: string) =>
    apiFetch<{ participant: ParticipantUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  authLogout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  authUpdateProfile: (payload: { nama?: string; noWhatsapp?: string }) =>
    apiFetch<{ participant: ParticipantUser }>('/api/auth/me', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getMyBookings: () => apiFetch<{ bookings: BookingDetail[] }>('/api/my-bookings'),
  getEvent: () => apiFetch<{ event: EventInfo; buses: BusInfo[] }>('/api/event'),
  getBusSeats: (busId: number) =>
    apiFetch<{ bus: BusInfo; seats: PublicSeat[] }>(
      `/api/buses/${busId}/seats?sessionId=${encodeURIComponent(getSessionId())}`
    ),
  holdSeats: (payload: {
    busId: number;
    mode: BookingMode;
    seats: Array<{ label: string; gender: Gender }>;
    ignoreSeatLabels?: string[];
  }) =>
    apiFetch<{ expiresAt: string; holdDurationSeconds: number }>('/api/holds', {
      method: 'POST',
      body: JSON.stringify({ ...payload, sessionId: getSessionId() }),
    }),
  releaseHold: () =>
    apiFetch<{ ok: boolean }>(`/api/holds/${encodeURIComponent(getSessionId())}`, {
      method: 'DELETE',
    }),
  createBooking: (payload: {
    busId: number;
    mode: BookingMode;
    namaPemesan: string;
    namaIstri?: string;
    gender?: Gender;
    noWhatsapp: string;
    seats: Array<{ label: string; role?: CoupleRole }>;
  }) =>
    apiFetch<{ booking: BookingDetail }>('/api/bookings', {
      method: 'POST',
      body: JSON.stringify({ ...payload, sessionId: getSessionId() }),
    }),
  lookupBookings: (whatsapp: string) =>
    apiFetch<{ bookings: PublicLookupBooking[] }>(
      `/api/bookings/lookup?whatsapp=${encodeURIComponent(whatsapp)}`
    ),
  getTicket: (kodeBooking: string, whatsapp: string) =>
    apiFetch<{ booking: BookingDetail }>(
      `/api/bookings/ticket/${encodeURIComponent(kodeBooking)}?whatsapp=${encodeURIComponent(whatsapp)}`
    ),
  cancelBooking: (bookingId: number, noWhatsapp: string) =>
    apiFetch<{ booking: BookingDetail }>(`/api/bookings/${bookingId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ noWhatsapp }),
    }),
  changeBookingSeats: (
    bookingId: number,
    payload: {
      noWhatsapp: string;
      busId: number;
      seats: Array<{ label: string; role?: CoupleRole }>;
    }
  ) =>
    apiFetch<{ booking: BookingDetail }>(`/api/bookings/${bookingId}/change-seats`, {
      method: 'POST',
      body: JSON.stringify({ ...payload, sessionId: getSessionId() }),
    }),
};

// Admin API
export const adminApi = {
  login: (email: string, password: string) =>
    apiFetch<{ admin: { id: number; nama: string; email: string; role: AdminRole } }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => apiFetch<{ ok: boolean }>('/api/admin/logout', { method: 'POST' }),
  me: () => apiFetch<{ admin: { id: number; nama: string; email: string; role: AdminRole } }>('/api/admin/me'),
  getDashboard: () =>
    apiFetch<{ event: EventInfo; summary: DashboardSummary; buses: BusInfo[] }>('/api/admin/dashboard'),
  updateEvent: (payload: Partial<EventInfo>) =>
    apiFetch<{ event: EventInfo }>('/api/admin/event', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getBuses: () => apiFetch<{ buses: BusInfo[] }>('/api/admin/buses'),
  createBus: (payload: { nama: string; platNomor: string; tipeArmada: string; posisiSopir: 'kanan' | 'kiri' }) =>
    apiFetch<{ buses: BusInfo[]; busId: number }>('/api/admin/buses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBus: (busId: number, payload: Partial<BusInfo>) =>
    apiFetch<{ buses: BusInfo[] }>(`/api/admin/buses/${busId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getBusSeats: (busId: number) =>
    apiFetch<{ bus: BusInfo; seats: AdminSeat[] }>(`/api/admin/buses/${busId}/seats`),
  toggleBlockSeat: (seatId: number, block: boolean, alasan?: string) =>
    apiFetch<{ ok: boolean }>(`/api/admin/seats/${seatId}/block`, {
      method: 'POST',
      body: JSON.stringify({ block, alasan }),
    }),
  manualBook: (payload: {
    busId: number;
    mode: BookingMode;
    namaPemesan: string;
    namaIstri?: string;
    gender?: Gender;
    noWhatsapp: string;
    seats: Array<{ label: string; role?: CoupleRole }>;
    override?: boolean;
    overrideReason?: string;
  }) =>
    apiFetch<{ booking: BookingDetail }>('/api/admin/bookings/manual', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  moveBookingSeats: (
    bookingId: number,
    payload: {
      busId: number;
      seats: Array<{ label: string; role?: CoupleRole }>;
      override?: boolean;
      overrideReason?: string;
    }
  ) =>
    apiFetch<{ booking: BookingDetail }>(`/api/admin/bookings/${bookingId}/move`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  cancelBooking: (bookingId: number, reason?: string) =>
    apiFetch<{ booking: BookingDetail }>(`/api/admin/bookings/${bookingId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  listBookings: (busId?: number) =>
    apiFetch<{ bookings: BookingDetail[] }>(
      busId ? `/api/admin/bookings?busId=${busId}` : '/api/admin/bookings'
    ),
  getAuditLogs: () => apiFetch<{ logs: AuditLogEntry[] }>('/api/admin/audit-logs'),
  deleteAuditLog: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/admin/audit-logs/${id}`, { method: 'DELETE' }),
  clearAuditLogs: () => apiFetch<{ ok: boolean }>('/api/admin/audit-logs', { method: 'DELETE' }),
};

