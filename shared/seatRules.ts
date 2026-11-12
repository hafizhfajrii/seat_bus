import type { Gender, PublicSeat, SeatTemplateItem } from './types.js';

export const LEG_REST_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export function buildBusSeatTemplates(): SeatTemplateItem[] {
  const seats: SeatTemplateItem[] = [];

  for (const row of LEG_REST_ROWS) {
    seats.push(
      {
        label: `${row}1`,
        tipe: 'leg_rest',
        baris: row,
        posisi: 1,
        sisi: 'kiri',
        adjacentLabels: [`${row}2`],
        posisiDesc: 'Kiri Luar (Jendela)',
      },
      {
        label: `${row}2`,
        tipe: 'leg_rest',
        baris: row,
        posisi: 2,
        sisi: 'kiri',
        adjacentLabels: [`${row}1`],
        posisiDesc: 'Kiri Dalam (Lorong)',
      },
      {
        label: `${row}3`,
        tipe: 'leg_rest',
        baris: row,
        posisi: 3,
        sisi: 'kanan',
        adjacentLabels: [`${row}4`],
        posisiDesc: 'Kanan Dalam (Lorong)',
      },
      {
        label: `${row}4`,
        tipe: 'leg_rest',
        baris: row,
        posisi: 4,
        sisi: 'kanan',
        adjacentLabels: [`${row}3`],
        posisiDesc: 'Kanan Luar (Jendela)',
      }
    );
  }

  for (let pos = 1; pos <= 6; pos++) {
    const adjacentLabels: string[] = [];
    if (pos > 1) adjacentLabels.push(`R${pos - 1}`);
    if (pos < 6) adjacentLabels.push(`R${pos + 1}`);
    seats.push({
      label: `R${pos}`,
      tipe: 'belakang',
      baris: 'R',
      posisi: pos,
      sisi: 'belakang',
      adjacentLabels,
      posisiDesc: pos === 1 ? 'Belakang Kiri' : pos === 6 ? 'Belakang Kanan' : `Belakang Tengah ${pos}`,
    });
  }

  return seats;
}

export const BUS_SEAT_TEMPLATES = buildBusSeatTemplates();

export function normalizeWhatsApp(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) {
    return '62' + digits.slice(1);
  }
  if (digits.startsWith('8')) {
    return '62' + digits;
  }
  return digits;
}

export function isValidWhatsApp(normalized: string): boolean {
  return /^628\d{7,12}$/.test(normalized);
}

export function formatWhatsAppDisplay(normalized: string): string {
  if (!normalized) return '-';
  const local = normalized.startsWith('62') ? '0' + normalized.slice(2) : normalized;
  if (local.length >= 10) {
    return `${local.slice(0, 4)}-${local.slice(4, 8)}-${local.slice(8)}`;
  }
  return local;
}

export function maskPersonName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => {
      if (part.length <= 2) return part[0] + '*';
      return part.slice(0, 2) + '*'.repeat(Math.min(part.length - 2, 5));
    })
    .join(' ');
}

export function maskWhatsApp(normalized: string): string {
  const display = formatWhatsAppDisplay(normalized);
  if (display.length <= 6) return display;
  return display.slice(0, 5) + '****' + display.slice(-3);
}

export interface RuleCheckOptions {
  ignoreSeatLabels?: string[];
  allowOverride?: boolean;
}

export interface SeatEligibilityResult {
  allowed: boolean;
  code:
    | 'OK'
    | 'OCCUPIED'
    | 'BLOCKED'
    | 'HELD_BY_OTHER'
    | 'FEMALE_ONLY'
    | 'MALE_ADJACENT';
  reason?: string;
}

function getEffectiveSeatGender(seat: PublicSeat, ignoreSet: Set<string>): Gender | null {
  if (ignoreSet.has(seat.label)) return null;
  if (seat.status === 'terisi' && seat.occupiedGender) {
    return seat.occupiedGender;
  }
  if (seat.status === 'ditahan' && !seat.heldBySelf && seat.heldGender) {
    return seat.heldGender;
  }
  return null;
}

export function getSeatNeighborTags(
  seat: PublicSeat,
  seatsMap: Map<string, PublicSeat>,
  ignoreSeatLabels: string[] = []
): { hasAdjacentFemale: boolean; hasAdjacentMale: boolean } {
  const ignoreSet = new Set(ignoreSeatLabels);
  let hasAdjacentFemale = false;
  let hasAdjacentMale = false;

  for (const adjLabel of seat.adjacentLabels) {
    const neighbor = seatsMap.get(adjLabel);
    if (!neighbor) continue;
    const g = getEffectiveSeatGender(neighbor, ignoreSet);
    if (g === 'P') hasAdjacentFemale = true;
    if (g === 'L') hasAdjacentMale = true;
  }

  return { hasAdjacentFemale, hasAdjacentMale };
}

export function getSeatEligibilityForSingle(
  seat: PublicSeat,
  seatsMap: Map<string, PublicSeat>,
  gender: Gender,
  options: RuleCheckOptions = {}
): SeatEligibilityResult {
  const ignoreSet = new Set(options.ignoreSeatLabels ?? []);

  if (!ignoreSet.has(seat.label)) {
    if (seat.status === 'terisi') {
      return {
        allowed: false,
        code: 'OCCUPIED',
        reason: `Kursi ${seat.label} sudah terisi.`,
      };
    }
    if (seat.status === 'diblokir') {
      return {
        allowed: false,
        code: 'BLOCKED',
        reason: seat.blockReason
          ? `Kursi ${seat.label} diblokir panitia (${seat.blockReason}).`
          : `Kursi ${seat.label} diblokir oleh panitia.`,
      };
    }
    if (seat.status === 'ditahan' && !seat.heldBySelf) {
      return {
        allowed: false,
        code: 'HELD_BY_OTHER',
        reason: `Kursi ${seat.label} sedang ditahan peserta lain.`,
      };
    }
  }

  if (options.allowOverride) {
    return { allowed: true, code: 'OK' };
  }

  const { hasAdjacentFemale, hasAdjacentMale } = getSeatNeighborTags(
    seat,
    seatsMap,
    options.ignoreSeatLabels ?? []
  );

  if (gender === 'L' && hasAdjacentFemale) {
    return {
      allowed: false,
      code: 'FEMALE_ONLY',
      reason: `Kursi ${seat.label} khusus perempuan karena bersebelahan dengan penumpang perempuan.`,
    };
  }

  if (gender === 'P' && hasAdjacentMale) {
    return {
      allowed: false,
      code: 'MALE_ADJACENT',
      reason: `Kursi ${seat.label} tidak dapat dipilih perempuan karena bersebelahan dengan penumpang laki-laki.`,
    };
  }

  return { allowed: true, code: 'OK' };
}

export interface CoupleValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateCoupleSelection(
  suamiSeat: PublicSeat,
  istriSeat: PublicSeat,
  seatsMap: Map<string, PublicSeat>,
  options: RuleCheckOptions = {}
): CoupleValidationResult {
  if (suamiSeat.busId !== istriSeat.busId) {
    return { valid: false, reason: 'Pasangan Suami & Istri harus memilih kursi di bus yang sama.' };
  }
  if (suamiSeat.label === istriSeat.label) {
    return { valid: false, reason: 'Kursi suami dan istri harus berbeda.' };
  }
  if (!suamiSeat.adjacentLabels.includes(istriSeat.label)) {
    return {
      valid: false,
      reason: `Kursi ${suamiSeat.label} dan ${istriSeat.label} tidak bersebelahan. Pasangan Suami & Istri wajib memilih dua kursi yang bersebelahan.`,
    };
  }

  const ignoreSet = new Set(options.ignoreSeatLabels ?? []);
  for (const s of [suamiSeat, istriSeat]) {
    if (!ignoreSet.has(s.label)) {
      if (s.status === 'terisi') {
        return { valid: false, reason: `Kursi ${s.label} sudah terisi.` };
      }
      if (s.status === 'diblokir') {
        return { valid: false, reason: `Kursi ${s.label} diblokir oleh panitia.` };
      }
      if (s.status === 'ditahan' && !s.heldBySelf) {
        return { valid: false, reason: `Kursi ${s.label} sedang ditahan peserta lain.` };
      }
    }
  }

  if (options.allowOverride) {
    return { valid: true };
  }

  // Check neighbors of suamiSeat (excluding istriSeat and ignored seats)
  const suamiIgnore = new Set([...ignoreSet, istriSeat.label]);
  for (const adj of suamiSeat.adjacentLabels) {
    const neighbor = seatsMap.get(adj);
    if (!neighbor) continue;
    const g = getEffectiveSeatGender(neighbor, suamiIgnore);
    if (g === 'P') {
      return {
        valid: false,
        reason: `Kursi suami (${suamiSeat.label}) tidak boleh bersebelahan dengan penumpang perempuan lain di ${adj}. Coba tukar posisi kursi suami & istri atau pilih pasangan kursi lain.`,
      };
    }
  }

  // Check neighbors of istriSeat (excluding suamiSeat and ignored seats)
  const istriIgnore = new Set([...ignoreSet, suamiSeat.label]);
  for (const adj of istriSeat.adjacentLabels) {
    const neighbor = seatsMap.get(adj);
    if (!neighbor) continue;
    const g = getEffectiveSeatGender(neighbor, istriIgnore);
    if (g === 'L') {
      return {
        valid: false,
        reason: `Kursi istri (${istriSeat.label}) tidak boleh bersebelahan dengan penumpang laki-laki lain di ${adj}. Coba tukar posisi kursi suami & istri atau pilih pasangan kursi lain.`,
      };
    }
  }

  return { valid: true };
}

export function getValidCoupleOrientations(
  seatA: PublicSeat,
  seatB: PublicSeat,
  seatsMap: Map<string, PublicSeat>,
  options: RuleCheckOptions = {}
): { aAsSuami: boolean; bAsSuami: boolean; errorReason?: string } {
  const resAB = validateCoupleSelection(seatA, seatB, seatsMap, options);
  const resBA = validateCoupleSelection(seatB, seatA, seatsMap, options);
  return {
    aAsSuami: resAB.valid,
    bAsSuami: resBA.valid,
    errorReason: !resAB.valid && !resBA.valid ? resAB.reason || resBA.reason : undefined,
  };
}

export function canSeatStartCouplePick(
  seat: PublicSeat,
  seatsMap: Map<string, PublicSeat>,
  options: RuleCheckOptions = {}
): { allowed: boolean; reason?: string } {
  const ignoreSet = new Set(options.ignoreSeatLabels ?? []);
  if (!ignoreSet.has(seat.label)) {
    if (seat.status === 'terisi') {
      return { allowed: false, reason: `Kursi ${seat.label} sudah terisi.` };
    }
    if (seat.status === 'diblokir') {
      return { allowed: false, reason: `Kursi ${seat.label} diblokir oleh panitia.` };
    }
    if (seat.status === 'ditahan' && !seat.heldBySelf) {
      return { allowed: false, reason: `Kursi ${seat.label} sedang ditahan peserta lain.` };
    }
  }

  for (const adjLabel of seat.adjacentLabels) {
    const neighbor = seatsMap.get(adjLabel);
    if (!neighbor) continue;
    const orient = getValidCoupleOrientations(seat, neighbor, seatsMap, options);
    if (orient.aAsSuami || orient.bAsSuami) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `Tidak ada kursi sebelah ${seat.label} yang tersedia untuk pasangan Suami & Istri.`,
  };
}

