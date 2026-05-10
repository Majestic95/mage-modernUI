import { describe, expect, it } from 'vitest';
import {
  damageParcelTravelMs,
  DAMAGE_PARCEL_TRAVEL_MS_HEAVY,
  DAMAGE_PARCEL_TRAVEL_MS_LIGHT,
  DAMAGE_PARCEL_TRAVEL_MS_MEDIUM,
  MIN_PARCEL_TRAVEL_MS,
  parcelSchedule,
} from './transitions';

describe('parcelSchedule', () => {
  it('amount=1 → 1 parcel filling the LIGHT budget (1000ms travel, no stagger)', () => {
    const s = parcelSchedule(1);
    expect(s.count).toBe(1);
    expect(s.travelMs).toBe(DAMAGE_PARCEL_TRAVEL_MS_LIGHT);
    expect(s.staggerMs).toBe(0);
    expect(s.totalMs).toBe(DAMAGE_PARCEL_TRAVEL_MS_LIGHT);
  });

  it('amount=2 → 2 parcels in the MEDIUM budget (2000ms total)', () => {
    const s = parcelSchedule(2);
    expect(s.count).toBe(2);
    expect(s.totalMs).toBe(DAMAGE_PARCEL_TRAVEL_MS_MEDIUM);
    // travel + stagger * (count-1) <= totalMs (last parcel lands at totalMs)
    expect(s.travelMs + s.staggerMs * (s.count - 1)).toBeLessThanOrEqual(
      DAMAGE_PARCEL_TRAVEL_MS_MEDIUM,
    );
    expect(s.travelMs).toBeGreaterThanOrEqual(MIN_PARCEL_TRAVEL_MS);
  });

  it('amount=4 → 4 parcels still inside MEDIUM 2000ms budget', () => {
    const s = parcelSchedule(4);
    expect(s.count).toBe(4);
    expect(s.totalMs).toBe(DAMAGE_PARCEL_TRAVEL_MS_MEDIUM);
    // Last parcel lands at most at totalMs.
    const lastLand = (s.count - 1) * s.staggerMs + s.travelMs;
    expect(lastLand).toBeLessThanOrEqual(DAMAGE_PARCEL_TRAVEL_MS_MEDIUM);
    expect(s.travelMs).toBeGreaterThanOrEqual(MIN_PARCEL_TRAVEL_MS);
  });

  it('amount=5 → 5 parcels in HEAVY 3000ms budget (each 600ms travel + 600ms stagger)', () => {
    const s = parcelSchedule(5);
    expect(s.count).toBe(5);
    expect(s.totalMs).toBe(DAMAGE_PARCEL_TRAVEL_MS_HEAVY);
    expect(s.travelMs).toBe(600);
    expect(s.staggerMs).toBe(600);
    // Last parcel lands at exactly 3000ms.
    expect((s.count - 1) * s.staggerMs + s.travelMs).toBe(3000);
  });

  it('amount=20 → 20 parcels still inside HEAVY 3000ms cap', () => {
    const s = parcelSchedule(20);
    expect(s.count).toBe(20);
    expect(s.totalMs).toBe(DAMAGE_PARCEL_TRAVEL_MS_HEAVY);
    expect(s.travelMs).toBeGreaterThanOrEqual(MIN_PARCEL_TRAVEL_MS);
    const lastLand = (s.count - 1) * s.staggerMs + s.travelMs;
    expect(lastLand).toBeLessThanOrEqual(DAMAGE_PARCEL_TRAVEL_MS_HEAVY);
  });

  it('amount=100 → 100 parcels still inside HEAVY 3000ms cap with floored travel', () => {
    // Pathological "super-trample" case. The schedule still respects
    // the budget; per-parcel travel is floored at MIN to keep parcels
    // visible.
    const s = parcelSchedule(100);
    expect(s.count).toBe(100);
    expect(s.travelMs).toBe(MIN_PARCEL_TRAVEL_MS);
    const lastLand = (s.count - 1) * s.staggerMs + s.travelMs;
    expect(lastLand).toBeLessThanOrEqual(DAMAGE_PARCEL_TRAVEL_MS_HEAVY);
  });

  it('amount<=0 → coerced to 1 parcel (defensive)', () => {
    expect(parcelSchedule(0).count).toBe(1);
    expect(parcelSchedule(-5).count).toBe(1);
  });

  it('amount=2.7 → floored to 2 parcels (defensive)', () => {
    expect(parcelSchedule(2.7).count).toBe(2);
  });

  it('damageParcelTravelMs tier mapping unchanged', () => {
    expect(damageParcelTravelMs(1)).toBe(DAMAGE_PARCEL_TRAVEL_MS_LIGHT);
    expect(damageParcelTravelMs(2)).toBe(DAMAGE_PARCEL_TRAVEL_MS_MEDIUM);
    expect(damageParcelTravelMs(4)).toBe(DAMAGE_PARCEL_TRAVEL_MS_MEDIUM);
    expect(damageParcelTravelMs(5)).toBe(DAMAGE_PARCEL_TRAVEL_MS_HEAVY);
    expect(damageParcelTravelMs(20)).toBe(DAMAGE_PARCEL_TRAVEL_MS_HEAVY);
  });
});
