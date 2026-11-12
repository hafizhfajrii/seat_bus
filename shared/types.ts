export type Gender = 'L' | 'P';
export type BookingMode = 'sendiri' | 'suami_istri';
export type CoupleRole = 'suami' | 'istri';
export type SeatType = 'leg_rest' | 'belakang';
export type SeatSide = 'kiri' | 'kanan' | 'belakang';
export type EventRegistrationStatus = 'buka' | 'tutup';
export type AdminRole = 'super_admin' | 'admin';

export interface SeatTemplateItem {
  label: string;
  tipe: SeatType;
  baris: string;
  posisi: number;
  sisi: SeatSide;
  adjacentLabels: string[];
  posisiDesc: string;
}

export type SeatOccupancyStatus = 'tersedia' | 'terisi' | 'diblokir' | 'ditahan';

export interface PublicSeat {
  id: number;
  busId: number;
  label: string;
  tipe: SeatType;
  baris: string;
  posisi: number;
  sisi: SeatSide;
  adjacentLabels: string[];
  posisiDesc: string;
  status: SeatOccupancyStatus;
  occupiedGender?: Gender | null;
  isCouple?: boolean;
  couplePairId?: number | null;
  heldBySelf?: boolean;
  heldGender?: Gender | null;
  holdExpiresAt?: string | null;
  blockReason?: string | null;
}

export interface AdminSeat extends PublicSeat {
  passengerName?: string | null;
  passengerPhone?: string | null;
  bookingCode?: string | null;
  bookingId?: number | null;
  bookingMode?: BookingMode | null;
  coupleRole?: CoupleRole | null;
  bookedAt?: string | null;
}

export interface EventInfo {
  id: number;
  nama: string;
  tanggal: string;
  jamBerangkat: string;
  lokasiBerangkat: string;
  titikKumpulDetail: string;
  deskripsi: string;
  statusPendaftaran: EventRegistrationStatus;
  batasWaktuPendaftaran?: string | null;
  batasPesananPerWa: number;
  durasiHoldDetik: number;
}

export interface BusInfo {
  id: number;
  eventId: number;
  nama: string;
  platNomor: string;
  tipeArmada: string;
  posisiSopir: 'kanan' | 'kiri';
  aktif: boolean;
  urutan: number;
  totalSeats: number;
  availableSeats: number;
  occupiedSeats: number;
  blockedSeats: number;
}

export interface BookingSeatDetail {
  seatId: number;
  label: string;
  tipe: SeatType;
  baris: string;
  posisiDesc: string;
  namaPenumpang: string;
  jenisKelamin: Gender;
  peranPasangan: CoupleRole | null;
}

export interface BookingDetail {
  id: number;
  kodeBooking: string;
  eventId: number;
  busId: number;
  busNama: string;
  busPlatNomor: string;
  busTipeArmada: string;
  mode: BookingMode;
  namaPemesan: string;
  noWhatsapp: string;
  status: 'aktif' | 'dibatalkan';
  dibuatPada: string;
  dibatalkanPada?: string | null;
  seats: BookingSeatDetail[];
}

export interface PublicLookupBooking {
  id: number;
  kodeBooking: string;
  busId: number;
  busNama: string;
  mode: BookingMode;
  maskedName: string;
  noWhatsappMasked: string;
  status: 'aktif' | 'dibatalkan';
  dibuatPada: string;
  seats: Array<{
    label: string;
    tipe: SeatType;
    jenisKelamin: Gender;
    peranPasangan: CoupleRole | null;
    maskedPassengerName: string;
  }>;
}

export interface AdminUser {
  id: number;
  nama: string;
  email: string;
  role: AdminRole;
  createdAt: string;
}

export interface ParticipantUser {
  id: number;
  email: string;
  nama: string;
  noWhatsapp: string;
  isPhoneRegistered: boolean;
  createdAt: string;
}

export interface RegisteredPhone {
  id: number;
  noWhatsapp: string;
  catatan: string;
  hasActiveBooking: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: number;
  adminId: number | null;
  adminNama: string;
  aksi: string;
  objek: string;
  detail: string;
  waktu: string;
}

export interface DashboardSummary {
  totalCapacity: number;
  totalOccupied: number;
  totalAvailable: number;
  totalBlocked: number;
  totalActiveHolds: number;
  maleCount: number;
  femaleCount: number;
  coupleCount: number;
  buses: Array<{
    busId: number;
    nama: string;
    total: number;
    occupied: number;
    available: number;
    blocked: number;
    maleCount: number;
    femaleCount: number;
  }>;
  recentBookings: BookingDetail[];
}

