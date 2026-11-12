import React, { useMemo } from 'react';
import type { AdminSeat, BookingMode, BusInfo, CoupleRole, Gender, PublicSeat } from '../../shared/types';
import {
  canSeatStartCouplePick,
  getSeatEligibilityForSingle,
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
          'bg-pink-50 dark:bg-pink-950/60 border border-pink-300 dark:border-pink-800 text-pink-800 dark:text-pink-200 ' +
          (viewType === 'participant' ? 'cursor-not-allowed' : 'hover:ring-2 hover:ring-pink-300 cursor-pointer');
      } else {
        containerClass =
          'bg-sky-50 dark:bg-sky-950/70 border border-sky-300 dark:border-sky-700 text-sky-800 dark:text-sky-200 ' +
          (viewType === 'participant' ? 'cursor-not-allowed' : 'hover:ring-2 hover:ring-sky-300 cursor-pointer');
      }

      if (seat.isCouple) {
        topBadge = (
          <span className="absolute top-0.5 right-0.5 flex items-center gap-0.5">
            <span
              className={`material-symbols-outlined text-[11px] ${
                isFemale ? 'text-pink-500 dark:text-pink-300' : 'text-sky-500 dark:text-sky-300'
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
                ? 'bg-pink-100 dark:bg-pink-900/80 text-pink-800 dark:text-pink-100'
                : 'bg-sky-100 dark:bg-sky-900/80 text-sky-800 dark:text-sky-100'
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

  const SteeringWheelIcon = () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-[18px] h-[18px] text-blue-600 dark:text-blue-400 shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 14v7" />
      <path d="M10.2 11 3.5 9.5" />
      <path d="M13.8 11 20.5 9.5" />
    </svg>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Bus Shell Frame Top-View */}
      <div className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-3xl p-3 sm:p-4 shadow-sm flex flex-col items-center relative overflow-hidden">
        {/* Windshield & Cockpit */}
        <div className="w-full max-w-[360px] flex flex-col items-center mb-3">
          <div className="w-44 h-3 bg-slate-300 dark:bg-slate-700 rounded-t-full opacity-80" />
          <div className="w-full py-2 px-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between text-slate-600 dark:text-slate-300 shadow-xs">
            {bus.posisiSopir === 'kiri' ? (
              <>
                <div className="flex items-center gap-1.5">
                  <SteeringWheelIcon />
                  <span className="text-[11px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-bold">
                    Sopir
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                    Kondektur
                  </span>
                  <span className="material-symbols-outlined text-[18px] text-slate-400">door_front</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px] text-slate-400">door_front</span>
                  <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                    Kondektur
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wider text-blue-600 dark:text-blue-400 font-bold">
                    Sopir
                  </span>
                  <SteeringWheelIcon />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Column Header */}
        <div className="w-full max-w-[360px] grid grid-cols-[1fr_1fr_32px_1fr_1fr] gap-1.5 text-center text-[11px] text-slate-500 dark:text-slate-400 mb-2 font-bold">
          <span>Kiri 1</span>
          <span>Kiri 2</span>
          <span />
          <span>Kanan 3</span>
          <span>Kanan 4</span>
        </div>

        {/* 8 Rows Leg Rest (A-H) */}
        <div className="w-full max-w-[360px] flex flex-col gap-2 relative">
          {LEG_REST_ROWS.map((row) => {
            const s1 = seatsMap.get(`${row}1`);
            const s2 = seatsMap.get(`${row}2`);
            const s3 = seatsMap.get(`${row}3`);
            const s4 = seatsMap.get(`${row}4`);
            return (
              <div key={row} className="grid grid-cols-[1fr_1fr_32px_1fr_1fr] gap-1.5 items-center">
                <div>{s1 && renderSeatButton(s1)}</div>
                <div>{s2 && renderSeatButton(s2)}</div>
                <div />
                <div>{s3 && renderSeatButton(s3)}</div>
                <div>{s4 && renderSeatButton(s4)}</div>
              </div>
            );
          })}
        </div>

        {/* Rear Row R1 - R6 */}
        <div className="w-full max-w-[360px] grid grid-cols-6 gap-1 mt-6 mb-1">
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
            <div className="w-4 h-4 rounded bg-sky-50 dark:bg-sky-950 border border-sky-300 dark:border-sky-700 flex items-center justify-center text-[9px] font-bold text-sky-800 dark:text-sky-200 shrink-0">
              L
            </div>
            <span className="text-slate-700 dark:text-slate-300">Terisi Laki-laki</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-pink-50 dark:bg-pink-950 border border-pink-300 dark:border-pink-800 flex items-center justify-center text-[9px] font-bold text-pink-800 dark:text-pink-200 shrink-0">
              P
            </div>
            <span className="text-slate-700 dark:text-slate-300">Terisi Perempuan</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[11px] text-slate-600 dark:text-slate-400">lock</span>
            </div>
            <span className="text-slate-700 dark:text-slate-300">Diblokir panitia</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-pink-50 dark:bg-pink-950 border border-pink-300 dark:border-pink-800 flex items-center justify-center shrink-0">
              <span
                className="material-symbols-outlined text-[12px] text-pink-500 dark:text-pink-300"
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

