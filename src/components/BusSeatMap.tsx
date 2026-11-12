import React, { useMemo } from 'react';
import type { AdminSeat, BookingMode, BusInfo, CoupleRole, Gender, PublicSeat } from '../../shared/types';
import {
  canSeatStartCouplePick,
  getSeatEligibilityForSingle,
  getSeatNeighborTags,
  getValidCoupleOrientations,
  LEG_REST_ROWS,
} from '../../shared/seatRules';

export interface SelectedSeatAssignment {
  label: string;
  role?: CoupleRole;
}

interface BusSeatMapProps {
  bus: BusInfo;
  seats: Array<PublicSeat | AdminSeat>;
  viewType: 'participant' | 'admin';
  mode?: BookingMode;
  gender?: Gender | null;
  selectedSeats?: SelectedSeatAssignment[];
  ignoreSeatLabels?: string[];
  adminSelectedSeatLabel?: string | null;
  onSelectSeat?: (seat: PublicSeat | AdminSeat) => void;
  onRejectedClick?: (reason: string) => void;
}

export const BusSeatMap: React.FC<BusSeatMapProps> = ({
  bus,
  seats,
  viewType,
  mode = 'sendiri',
  gender = null,
  selectedSeats = [],
  ignoreSeatLabels = [],
  adminSelectedSeatLabel = null,
  onSelectSeat,
  onRejectedClick,
}) => {
  const seatsMap = useMemo(() => new Map(seats.map((s) => [s.label, s])), [seats]);
  const selectedMap = useMemo(
    () => new Map(selectedSeats.map((s) => [s.label, s])),
    [selectedSeats]
  );

  const firstCoupleSeat = useMemo(() => {
    if (mode !== 'suami_istri' || selectedSeats.length !== 1) return null;
    return seatsMap.get(selectedSeats[0].label) ?? null;
  }, [mode, selectedSeats, seatsMap]);

  const handleSeatPress = (seat: PublicSeat | AdminSeat) => {
    if (viewType === 'admin') {
      onSelectSeat?.(seat);
      return;
    }

    // Participant mode
    if (selectedMap.has(seat.label)) {
      onSelectSeat?.(seat);
      return;
    }

    if (mode === 'sendiri') {
      if (!gender) {
        onRejectedClick?.('Silakan pilih jenis kelamin (Laki-laki atau Perempuan) terlebih dahulu sebelum memilih kursi.');
        return;
      }
      const check = getSeatEligibilityForSingle(seat, seatsMap, gender, { ignoreSeatLabels });
      if (!check.allowed) {
        onRejectedClick?.(check.reason ?? 'Kursi tidak dapat dipilih.');
        return;
      }
      onSelectSeat?.(seat);
      return;
    }

    // Mode Suami & Istri
    if (selectedSeats.length === 1 && firstCoupleSeat) {
      if (firstCoupleSeat.adjacentLabels.includes(seat.label)) {
        const orient = getValidCoupleOrientations(firstCoupleSeat, seat, seatsMap, { ignoreSeatLabels });
        if (!orient.aAsSuami && !orient.bAsSuami) {
          onRejectedClick?.(orient.errorReason ?? 'Pasangan kursi ini melanggar aturan kursi perempuan.');
          return;
        }
        onSelectSeat?.(seat);
        return;
      }
      // Clicked non-adjacent seat -> treat as starting a new 1st selection if valid
    }

    const startCheck = canSeatStartCouplePick(seat, seatsMap, { ignoreSeatLabels });
    if (!startCheck.allowed) {
      onRejectedClick?.(startCheck.reason ?? 'Kursi tidak dapat dipilih untuk pasangan.');
      return;
    }
    onSelectSeat?.(seat);
  };

  const renderSeatButton = (seat: PublicSeat | AdminSeat, isRear = false) => {
    const adminSeat = seat as AdminSeat;
    const isAdminSelected = viewType === 'admin' && adminSelectedSeatLabel === seat.label;
    const picked = selectedMap.get(seat.label);
    const isIgnoredOldSeat = ignoreSeatLabels.includes(seat.label);
    const effectiveStatus = isIgnoredOldSeat && !picked ? 'tersedia' : seat.status;

    const { hasAdjacentFemale, hasAdjacentMale } = getSeatNeighborTags(
      seat,
      seatsMap,
      ignoreSeatLabels
    );

    const isCouplePartnerCandidate =
      viewType === 'participant' &&
      mode === 'suami_istri' &&
      firstCoupleSeat !== null &&
      firstCoupleSeat.adjacentLabels.includes(seat.label) &&
      (() => {
        const o = getValidCoupleOrientations(firstCoupleSeat, seat, seatsMap, { ignoreSeatLabels });
        return o.aAsSuami || o.bAsSuami;
      })();

    // Determine visual classes and badges
    let containerClass = '';
    let topBadge: React.ReactNode = null;
    let mainLabel = seat.label;
    let subLabel: string = isRear ? 'STD' : 'LEG';
    let strikeLabel = false;
    let tooltip = `${seat.label} • ${seat.posisiDesc}`;

    if (picked) {
      containerClass =
        'bg-blue-600 text-white border-2 border-blue-700 shadow-lg shadow-blue-500/30 ring-2 ring-blue-300 scale-[1.03] z-20';
      subLabel =
        mode === 'suami_istri'
          ? picked.role === 'suami'
            ? 'SUAMI'
            : 'ISTRI'
          : 'DIPILIH';
      tooltip = `Kursi ${seat.label} sedang Anda pilih`;
    } else if (effectiveStatus === 'terisi') {
      strikeLabel = viewType === 'participant';
      const isFemale = seat.occupiedGender === 'P';
      if (isFemale) {
        containerClass =
          'bg-rose-100 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 ' +
          (viewType === 'participant' ? 'cursor-not-allowed' : 'hover:ring-2 hover:ring-rose-400 cursor-pointer');
      } else {
        containerClass =
          'bg-sky-100 dark:bg-sky-950/80 border border-sky-300 dark:border-sky-700 text-sky-900 dark:text-sky-200 ' +
          (viewType === 'participant' ? 'cursor-not-allowed' : 'hover:ring-2 hover:ring-blue-400 cursor-pointer');
      }

      if (seat.isCouple) {
        topBadge = (
          <span className="absolute top-0.5 right-0.5 flex items-center gap-0.5">
            <span
              className={`material-symbols-outlined text-[11px] ${
                isFemale ? 'text-rose-600 dark:text-rose-400' : 'text-blue-600 dark:text-sky-400'
              }`}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              favorite
            </span>
          </span>
        );
      } else {
        topBadge = (
          <span
            className={`absolute top-0.5 right-0.5 px-1 rounded text-[9px] font-extrabold leading-tight ${
              isFemale
                ? 'bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-100'
                : 'bg-sky-200 dark:bg-sky-900 text-sky-900 dark:text-sky-100'
            }`}
          >
            {seat.occupiedGender}
          </span>
        );
      }

      if (viewType === 'admin' && adminSeat.passengerName) {
        subLabel = adminSeat.passengerName.split(' ')[0].slice(0, 6).toUpperCase();
        tooltip = `${seat.label}: ${adminSeat.passengerName} (${seat.occupiedGender})`;
      } else {
        subLabel = seat.isCouple ? 'PASUTRI' : 'TERISI';
        tooltip = `Kursi ${seat.label} sudah terisi (${seat.occupiedGender === 'P' ? 'Perempuan' : 'Laki-laki'})`;
      }
    } else if (effectiveStatus === 'diblokir') {
      containerClass =
        'bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 ' +
        (viewType === 'participant' ? 'cursor-not-allowed' : 'hover:ring-2 hover:ring-slate-400 cursor-pointer');
      topBadge = (
        <span className="material-symbols-outlined text-[11px] absolute top-0.5 right-0.5 text-slate-500 dark:text-slate-400">
          lock
        </span>
      );
      subLabel = 'BLOKIR';
      tooltip = seat.blockReason ? `Diblokir: ${seat.blockReason}` : 'Kursi diblokir panitia';
    } else if (effectiveStatus === 'ditahan' && !seat.heldBySelf) {
      containerClass =
        'bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 ' +
        (viewType === 'participant' ? 'cursor-not-allowed' : 'cursor-pointer');
      topBadge = (
        <span className="material-symbols-outlined text-[11px] absolute top-0.5 right-0.5 text-amber-600 dark:text-amber-400">
          timer
        </span>
      );
      subLabel = 'TAHAN';
      tooltip = `Kursi ${seat.label} sedang ditahan sementara oleh peserta lain`;
    } else if (viewType === 'participant' && mode === 'sendiri' && gender === 'P' && hasAdjacentMale) {
      containerClass =
        'seat-hatch-male-blocked border border-dashed border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed';
      topBadge = (
        <span className="material-symbols-outlined text-[11px] absolute top-0.5 right-0.5 text-slate-400 dark:text-slate-500">
          block
        </span>
      );
      subLabel = 'BLOK L';
      tooltip = `Kursi ${seat.label} bersebelahan dengan penumpang laki-laki`;
    } else if (hasAdjacentFemale) {
      const blockedForMale = viewType === 'participant' && mode === 'sendiri' && gender === 'L';
      containerClass = blockedForMale
        ? 'seat-hatch-female border-2 border-dashed border-rose-300 dark:border-rose-800 text-rose-500 dark:text-rose-300 opacity-85 cursor-not-allowed'
        : 'seat-hatch-female border-2 border-dashed border-rose-400 dark:border-rose-500 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/50 active:scale-95 cursor-pointer';
      subLabel = 'KHUSUS P';
      tooltip = blockedForMale
        ? `Kursi ${seat.label} khusus perempuan (bersebelahan dengan penumpang perempuan)`
        : `Kursi ${seat.label} khusus penumpang perempuan`;
    } else if (isRear) {
      containerClass =
        'bg-indigo-50 dark:bg-indigo-950/75 border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/80 text-indigo-900 dark:text-indigo-200 active:scale-95 cursor-pointer shadow-xs';
    } else {
      containerClass =
        'bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/75 text-emerald-900 dark:text-emerald-200 active:scale-95 cursor-pointer shadow-xs';
    }

    if (isCouplePartnerCandidate && !picked) {
      containerClass += ' ring-2 ring-blue-500 ring-offset-1 animate-pulse';
    }

    if (isAdminSelected) {
      containerClass += ' ring-2 ring-blue-600 ring-offset-1';
    }

    return (
      <button
        key={seat.label}
        type="button"
        title={tooltip}
        aria-label={tooltip}
        onClick={() => handleSeatPress(seat)}
        className={`min-h-[44px] w-full rounded-lg transition-all flex flex-col items-center justify-center relative select-none px-0.5 ${containerClass}`}
      >
        {topBadge}
        <span
          className={`text-[13px] leading-tight font-bold tracking-tight ${
            strikeLabel ? 'line-through opacity-75' : ''
          }`}
        >
          {mainLabel}
        </span>
        <span className="text-[9px] leading-none font-extrabold tracking-wide uppercase mt-0.5 truncate max-w-full px-0.5">
          {subLabel}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Bus Shell Frame Top-View */}
      <div className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-3 sm:p-4 shadow-sm flex flex-col items-center relative overflow-hidden">
        {/* Windshield & Cockpit */}
        <div className="w-full max-w-[360px] flex flex-col items-center mb-3">
          <div className="w-44 h-3 bg-slate-300 dark:bg-slate-700 rounded-t-full opacity-80" />
          <div className="w-full py-2 px-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between text-slate-600 dark:text-slate-300 shadow-xs">
            {bus.posisiSopir === 'kiri' ? (
              <>
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[18px] text-blue-600 dark:text-blue-400">sports_score</span>
                  <span className="text-[11px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-bold">Sopir</span>
                </div>
                <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-[11px] text-slate-700 dark:text-slate-200 font-bold">
                  <span className="material-symbols-outlined text-[15px] text-blue-600 dark:text-blue-400">arrow_upward</span>
                  <span>DEPAN</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">Pintu</span>
                  <span className="material-symbols-outlined text-[18px] text-slate-400">door_front</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[18px] text-slate-400">door_front</span>
                  <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">Kondektur</span>
                </div>
                <div className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-[11px] text-slate-700 dark:text-slate-200 font-bold">
                  <span className="material-symbols-outlined text-[15px] text-blue-600 dark:text-blue-400">arrow_upward</span>
                  <span>DEPAN (SOPIR)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-bold">Sopir</span>
                  <span className="material-symbols-outlined text-[18px] text-blue-600 dark:text-blue-400">sports_score</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Column Header */}
        <div className="w-full max-w-[360px] grid grid-cols-[1fr_1fr_32px_1fr_1fr] gap-1.5 text-center text-[11px] text-slate-500 dark:text-slate-400 mb-2 font-bold">
          <span>Kiri 1</span>
          <span>Kiri 2</span>
          <span className="text-slate-400 dark:text-slate-500 uppercase text-[9px] tracking-wider self-center">Lorong</span>
          <span>Kanan 3</span>
          <span>Kanan 4</span>
        </div>

        {/* 8 Rows Leg Rest (A-H) */}
        <div className="w-full max-w-[360px] flex flex-col gap-2 relative">
          {/* Center aisle dashed guide */}
          <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-8 flex justify-center pointer-events-none">
            <div className="w-[1px] h-full border-r border-dashed border-slate-300 dark:border-slate-700" />
          </div>

          {LEG_REST_ROWS.map((row) => {
            const s1 = seatsMap.get(`${row}1`);
            const s2 = seatsMap.get(`${row}2`);
            const s3 = seatsMap.get(`${row}3`);
            const s4 = seatsMap.get(`${row}4`);
            return (
              <div key={row} className="grid grid-cols-[1fr_1fr_32px_1fr_1fr] gap-1.5 items-center">
                <div>{s1 && renderSeatButton(s1)}</div>
                <div>{s2 && renderSeatButton(s2)}</div>
                <span className="text-center text-[11px] text-slate-400 dark:text-slate-500 font-bold z-10 bg-slate-100/90 dark:bg-slate-900/90 py-0.5 rounded">
                  {row}
                </span>
                <div>{s3 && renderSeatButton(s3)}</div>
                <div>{s4 && renderSeatButton(s4)}</div>
              </div>
            );
          })}
        </div>

        {/* Rear Row Divider */}
        <div className="w-full max-w-[360px] flex items-center justify-center gap-2 my-3">
          <div className="flex-1 h-[1px] bg-slate-300 dark:bg-slate-700" />
          <span className="text-[11px] text-slate-600 dark:text-slate-300 font-semibold px-1.5 whitespace-nowrap">
            — Seat Belakang (6 Kursi) —
          </span>
          <div className="flex-1 h-[1px] bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Rear Row R1 - R6 */}
        <div className="w-full max-w-[360px] grid grid-cols-6 gap-1 mb-1">
          {[1, 2, 3, 4, 5, 6].map((pos) => {
            const seat = seatsMap.get(`R${pos}`);
            return <div key={pos}>{seat && renderSeatButton(seat, true)}</div>;
          })}
        </div>

        {/* Rear Bumper */}
        <div className="w-32 h-2 bg-slate-300 dark:bg-slate-700 rounded-b-full opacity-70 mt-2" />
      </div>

      {/* Legend Card */}
      <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl flex flex-col gap-2.5 shadow-sm">
        <span className="text-[13px] text-slate-900 dark:text-slate-100 font-bold">Keterangan Denah Kursi:</span>
        <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-emerald-100 dark:bg-emerald-950 border border-emerald-400 dark:border-emerald-700 shrink-0" />
            <span className="text-slate-700 dark:text-slate-300">Leg rest tersedia</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-blue-600 shrink-0" />
            <span className="text-slate-900 dark:text-white font-semibold">Sedang dipilih</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-indigo-100 dark:bg-indigo-950 border border-indigo-300 dark:border-indigo-700 shrink-0" />
            <span className="text-slate-700 dark:text-slate-300">Belakang tersedia</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-sky-100 dark:bg-sky-950 border border-sky-300 dark:border-sky-700 flex items-center justify-center text-[9px] font-bold text-sky-900 dark:text-sky-200 shrink-0">
              L
            </div>
            <span className="text-slate-700 dark:text-slate-300">Terisi Laki-laki</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-rose-100 dark:bg-rose-950 border border-rose-300 dark:border-rose-700 flex items-center justify-center text-[9px] font-bold text-rose-800 dark:text-rose-200 shrink-0">
              P
            </div>
            <span className="text-slate-700 dark:text-slate-300">Terisi Perempuan</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded seat-hatch-female border border-dashed border-rose-400 dark:border-rose-500 flex items-center justify-center text-[8px] font-bold text-rose-700 dark:text-rose-200 shrink-0">
              P*
            </div>
            <span className="text-slate-700 dark:text-slate-300">Khusus Perempuan</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[11px] text-slate-600 dark:text-slate-400">lock</span>
            </div>
            <span className="text-slate-700 dark:text-slate-300">Diblokir panitia</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-rose-100 dark:bg-rose-950 border border-rose-300 dark:border-rose-700 flex items-center justify-center shrink-0">
              <span
                className="material-symbols-outlined text-[12px] text-rose-600 dark:text-rose-400"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                favorite
              </span>
            </div>
            <span className="text-slate-700 dark:text-slate-300">Pasangan Suami-Istri</span>
          </div>
        </div>
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl text-slate-600 dark:text-slate-300 text-xs flex items-start gap-2 border dark:border-slate-700/70">
          <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-[18px] shrink-0 mt-0.5">info</span>
          <span className="leading-relaxed">
            Seat di sebelah penumpang perempuan hanya bisa dipilih perempuan atau pasangan Suami &amp; Istri.
          </span>
        </div>
      </div>
    </div>
  );
};

