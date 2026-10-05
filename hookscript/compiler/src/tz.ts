// Timezones the compiler knows: standard offset (minutes), DST rule (0 none, 1 US/Canada, 2 EU/UK, 3 SE Australia)
// and a main city (lat/lon in 1/100 degree) for daylight(tz:).

export interface Zone { name: string; off: number; rule: number; lat?: number; lon?: number }

const Z: [string, number, number, number, number, string[]][] = [
  ['UTC', 0, 0, 5148, 0, ['GMT', 'Z', 'Etc/UTC', 'Etc/GMT', 'Universal']],
  ['America/New_York', -300, 1, 4071, -7401, ['ET', 'EST', 'EDT', 'US/Eastern', 'New York', 'NYC', 'Eastern']],
  ['America/Toronto', -300, 1, 4365, -7938, ['Toronto']],
  ['America/Chicago', -360, 1, 4188, -8763, ['CT', 'CST', 'CDT', 'US/Central', 'Chicago', 'Central']],
  ['America/Denver', -420, 1, 3974, -10499, ['MT', 'MST', 'MDT', 'US/Mountain', 'Denver', 'Mountain']],
  ['America/Phoenix', -420, 0, 3345, -11207, ['Phoenix', 'US/Arizona']],
  ['America/Los_Angeles', -480, 1, 3405, -11824, ['PT', 'PST', 'PDT', 'US/Pacific', 'Los Angeles', 'LA', 'San Francisco', 'Pacific']],
  ['America/Vancouver', -480, 1, 4928, -12312, ['Vancouver']],
  ['America/Anchorage', -540, 1, 6122, -14990, ['Anchorage', 'US/Alaska']],
  ['Pacific/Honolulu', -600, 0, 2131, -15786, ['Honolulu', 'HST', 'US/Hawaii', 'Hawaii']],
  ['America/Mexico_City', -360, 0, 1943, -9913, ['Mexico City']],
  ['America/Bogota', -300, 0, 471, -7407, ['Bogota']],
  ['America/Lima', -300, 0, -1205, -7704, ['Lima']],
  ['America/Sao_Paulo', -180, 0, -2355, -4663, ['Sao Paulo', 'São Paulo', 'Brazil', 'BRT']],
  ['America/Argentina/Buenos_Aires', -180, 0, -3460, -5838, ['Buenos Aires', 'America/Buenos_Aires', 'ART']],
  ['Europe/London', 0, 2, 5151, -13, ['London', 'UK', 'BST', 'Europe/Belfast', 'GB']],
  ['Europe/Dublin', 0, 2, 5335, -626, ['Dublin', 'Ireland']],
  ['Europe/Lisbon', 0, 2, 3872, -914, ['Lisbon', 'Portugal', 'WET']],
  ['Europe/Paris', 60, 2, 4886, 235, ['Paris', 'France', 'CET', 'CEST']],
  ['Europe/Berlin', 60, 2, 5252, 1340, ['Berlin', 'Germany']],
  ['Europe/Madrid', 60, 2, 4042, -370, ['Madrid', 'Spain']],
  ['Europe/Rome', 60, 2, 4190, 1250, ['Rome', 'Italy']],
  ['Europe/Amsterdam', 60, 2, 5237, 490, ['Amsterdam', 'Netherlands']],
  ['Europe/Brussels', 60, 2, 5085, 435, ['Brussels', 'Belgium']],
  ['Europe/Zurich', 60, 2, 4738, 854, ['Zurich', 'Switzerland']],
  ['Europe/Vienna', 60, 2, 4821, 1637, ['Vienna', 'Austria']],
  ['Europe/Stockholm', 60, 2, 5933, 1807, ['Stockholm', 'Sweden']],
  ['Europe/Oslo', 60, 2, 5991, 1075, ['Oslo', 'Norway']],
  ['Europe/Copenhagen', 60, 2, 5568, 1257, ['Copenhagen', 'Denmark']],
  ['Europe/Warsaw', 60, 2, 5223, 2101, ['Warsaw', 'Poland']],
  ['Europe/Prague', 60, 2, 5008, 1444, ['Prague']],
  ['Europe/Athens', 120, 2, 3798, 2373, ['Athens', 'Greece', 'EET', 'EEST']],
  ['Europe/Helsinki', 120, 2, 6017, 2494, ['Helsinki', 'Finland']],
  ['Europe/Kyiv', 120, 2, 5045, 3052, ['Kyiv', 'Kiev', 'Europe/Kiev', 'Ukraine']],
  ['Europe/Bucharest', 120, 2, 4443, 2610, ['Bucharest', 'Romania']],
  ['Europe/Istanbul', 180, 0, 4101, 2898, ['Istanbul', 'Turkey', 'TRT']],
  ['Europe/Moscow', 180, 0, 5576, 3762, ['Moscow', 'MSK']],
  ['Africa/Lagos', 60, 0, 652, 338, ['Lagos', 'Nigeria', 'WAT']],
  ['Africa/Johannesburg', 120, 0, -2620, 2805, ['Johannesburg', 'South Africa', 'SAST']],
  ['Africa/Nairobi', 180, 0, -129, 3682, ['Nairobi', 'Kenya', 'EAT']],
  ['Asia/Dubai', 240, 0, 2520, 5527, ['Dubai', 'UAE', 'GST']],
  ['Asia/Karachi', 300, 0, 2486, 6701, ['Karachi', 'Pakistan', 'PKT']],
  ['Asia/Kolkata', 330, 0, 2861, 7721, ['Kolkata', 'Asia/Calcutta', 'India', 'IST', 'Mumbai', 'Delhi', 'New Delhi']],
  ['Asia/Dhaka', 360, 0, 2381, 9041, ['Dhaka', 'Bangladesh']],
  ['Asia/Bangkok', 420, 0, 1376, 10050, ['Bangkok', 'Thailand', 'ICT']],
  ['Asia/Jakarta', 420, 0, -621, 10685, ['Jakarta', 'Indonesia', 'WIB']],
  ['Asia/Ho_Chi_Minh', 420, 0, 1082, 10663, ['Ho Chi Minh', 'Saigon', 'Vietnam']],
  ['Asia/Shanghai', 480, 0, 3123, 12147, ['Shanghai', 'Beijing', 'China', 'Asia/Chongqing', 'PRC']],
  ['Asia/Hong_Kong', 480, 0, 2232, 11417, ['Hong Kong', 'HKT']],
  ['Asia/Singapore', 480, 0, 135, 10382, ['Singapore', 'SGT']],
  ['Asia/Taipei', 480, 0, 2503, 12157, ['Taipei', 'Taiwan']],
  ['Asia/Manila', 480, 0, 1460, 12098, ['Manila', 'Philippines']],
  ['Australia/Perth', 480, 0, -3195, 11586, ['Perth', 'AWST']],
  ['Asia/Seoul', 540, 0, 3757, 12698, ['Seoul', 'Korea', 'KST']],
  ['Asia/Tokyo', 540, 0, 3568, 13969, ['Tokyo', 'Japan', 'JST']],
  ['Australia/Brisbane', 600, 0, -2747, 15303, ['Brisbane']],
  ['Australia/Sydney', 600, 3, -3387, 15121, ['Sydney', 'AEST', 'AEDT', 'Australia/NSW', 'Australia/ACT', 'Canberra']],
  ['Australia/Melbourne', 600, 3, -3781, 14496, ['Melbourne', 'Australia/Victoria']],
];

const BY: Map<string, Zone> = new Map();
for (const [name, off, rule, lat, lon, aliases] of Z) {
  const z = { name, off, rule, lat, lon };
  for (const k of [name, ...aliases, name.split('/').pop()!.replace(/_/g, ' ')]) BY.set(k.toLowerCase(), z);
}

/** Zones with DST rules this VM doesn't model: the compiler refuses them with a hint. */
export const UNSUPPORTED = new Set(['pacific/auckland', 'auckland', 'new zealand', 'nz', 'africa/cairo', 'cairo', 'america/santiago', 'santiago', 'asia/tehran', 'tehran', 'asia/jerusalem', 'jerusalem', 'america/havana', 'australia/adelaide', 'adelaide']);

/** Resolve "Asia/Tokyo", "Tokyo", "UTC+8", "-05:30", "GMT+2" … Returns undefined if unknown. */
export function zone(s: string): Zone | undefined {
  const k = s.trim().toLowerCase();
  const z = BY.get(k);
  if (z) return z;
  const m = k.match(/^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/);
  if (m) {
    const mins = (Number(m[2]) * 60 + Number(m[3] ?? 0)) * (m[1] === '-' ? -1 : 1);
    if (Math.abs(mins) <= 14 * 60) return { name: s.trim().toUpperCase(), off: mins, rule: 0 };
  }
  return undefined;
}

export const knownZones = () => Z.map((z) => z[0]);
