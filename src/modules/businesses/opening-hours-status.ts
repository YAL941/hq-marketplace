import type { OpeningHoursRow } from './business.repository.js';

export interface CurrentDayHours {
    opens_at: string;
    closes_at: string;
}

export interface PublicHoursStatus {
    is_open_now: boolean;
    current_day_hours: CurrentDayHours | null;
}

const MOGADISHU_WEEKDAY: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

function minutesAfterMidnight(value: string): number {
    const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
    if (!match) return -1;
    return Number(match[1]) * 60 + Number(match[2]);
}

function displayTime(value: string): string {
    return value.slice(0, 5);
}

export function getPublicHoursStatus(
    openingHours: readonly OpeningHoursRow[],
    now: Date = new Date(),
): PublicHoursStatus {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Mogadishu',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now);
    const values = new Map(parts.map(({ type, value }) => [type, value]));
    const day = MOGADISHU_WEEKDAY[values.get('weekday') ?? ''];
    const hour = Number(values.get('hour'));
    const minute = Number(values.get('minute'));
    const currentMinute = hour * 60 + minute;
    const today = openingHours.find((entry) => entry.day_of_week === day);
    const current_day_hours = today && !today.is_closed && today.opens_at && today.closes_at
        ? { opens_at: displayTime(today.opens_at), closes_at: displayTime(today.closes_at) }
        : null;

    if (!current_day_hours || currentMinute < 0 || currentMinute >= 24 * 60) {
        return { is_open_now: false, current_day_hours };
    }

    const opens = minutesAfterMidnight(current_day_hours.opens_at);
    const closes = minutesAfterMidnight(current_day_hours.closes_at);
    return {
        is_open_now: opens >= 0 && closes > opens && currentMinute >= opens && currentMinute < closes,
        current_day_hours,
    };
}
