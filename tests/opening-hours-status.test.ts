import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getPublicHoursStatus } from '../src/modules/businesses/opening-hours-status.js';
import type { OpeningHoursRow } from '../src/modules/businesses/business.repository.js';

const weeklyHours: OpeningHoursRow[] = Array.from({ length: 7 }, (_, day_of_week) => ({
    day_of_week,
    opens_at: '09:00:00',
    closes_at: '17:00:00',
    is_closed: false,
}));

describe('public opening-hours status in Africa/Mogadishu', () => {
    it('returns open during today’s scheduled interval', () => {
        const result = getPublicHoursStatus(weeklyHours, new Date('2026-10-19T07:00:00.000Z'));
        assert.deepEqual(result, {
            is_open_now: true,
            current_day_hours: { opens_at: '09:00', closes_at: '17:00' },
        });
    });

    it('treats closing time as closed', () => {
        const result = getPublicHoursStatus(weeklyHours, new Date('2026-10-19T14:00:00.000Z'));
        assert.equal(result.is_open_now, false);
    });

    it('uses the Mogadishu weekday across a UTC date boundary', () => {
        const hours = weeklyHours.map((entry) => entry.day_of_week === 1
            ? { ...entry, opens_at: '00:00:00', closes_at: '01:00:00' }
            : { ...entry, is_closed: true, opens_at: null, closes_at: null });
        const result = getPublicHoursStatus(hours, new Date('2026-10-18T21:30:00.000Z'));
        assert.deepEqual(result, {
            is_open_now: true,
            current_day_hours: { opens_at: '00:00', closes_at: '01:00' },
        });
    });

    it('returns closed with null current-day hours when no schedule is published', () => {
        const result = getPublicHoursStatus([], new Date('2026-10-19T07:00:00.000Z'));
        assert.deepEqual(result, { is_open_now: false, current_day_hours: null });
    });
});
