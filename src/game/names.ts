export const MALE_NAMES = [
  'أحمد',
  'سالم',
  'يوسف',
  'طارق',
  'كريم',
  'ناصر',
  'خالد',
  'عمر',
  'زيد',
  'بدر',
  'سعيد',
  'حسن',
  'ماجد',
  'رامي',
  'نبيل',
  'وليد',
  'فارس',
  'رشيد',
  'سامي',
  'منصور',
  'جاسم',
  'عدنان',
  'هشام',
  'محمود',
] as const;

export const FEMALE_NAMES = [
  'ليلى',
  'سلمى',
  'نور',
  'مريم',
  'هند',
  'دلال',
  'آمنة',
  'زينب',
  'ريم',
  'سارة',
  'فاطمة',
  'ياسمين',
  'رقية',
  'ندى',
  'حليمة',
  'سميرة',
] as const;

export function pickCitizenName(gender: 'm' | 'f', seed: number): string {
  const list = gender === 'f' ? FEMALE_NAMES : MALE_NAMES;
  const idx = Math.abs(Math.floor(seed)) % list.length;
  return list[idx];
}
