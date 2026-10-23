// Vietnamese is the primary language; English mirrors every key.
export type Lang = 'vi' | 'en';

const vi = {
  title: 'Vườn Chung',
  coins: 'xu',
  'sp.rau_muong': 'Rau muống',
  'sp.strawberry': 'Dâu tây',
  'sp.sunflower': 'Hoa hướng dương',
  tilled: 'Đã xới đất',
  already_tilled: 'Đất đã xới rồi',
  planted: 'Đã gieo {species}',
  not_tilled: 'Phải xới đất trước',
  occupied: 'Ô này đã có cây',
  no_seeds: 'Hết hạt {species} — ghé sạp Cô Ba nhé',
  watered: 'Đã tưới nước 💧',
  already_wet: 'Đất còn ẩm, chưa cần tưới',
  nothing_to_water: 'Không có gì để tưới',
  harvested: 'Thu hoạch {n} {species} {stars}',
  not_ready: 'Chưa chín đâu',
  nothing_here: 'Không có gì ở đây',
  shipped: 'Đã bỏ {n} món vào thùng hàng (≈{value} xu, trả lúc nửa đêm)',
  nothing_to_ship: 'Túi đồ chưa có nông sản',
  bought: 'Đã mua {n} hạt {species}',
  not_enough_coins: 'Không đủ xu',
  payout: 'Thùng hàng đêm qua: +{value} xu 🎉',
  growing: '{species} đang lớn · {pct}%',
  wilted: '{species} héo rồi, tưới ngay nhé',
  cant_farm: 'Chỉ trồng được trong vườn có rào',
  bin: 'Thùng hàng',
  shop: 'Sạp của Cô Ba',
  shop_hint: 'Mua hạt giống',
  buy: 'Mua',
  close: 'Đóng',
  seeds: 'Hạt giống',
  bag: 'Túi',
  empty_bag: 'Trống',
  action: 'Làm',
  help: 'Di chuyển: WASD/mũi tên · Làm: Space · Chọn hạt: 1–3',
  welcome: 'Chào mừng về Vườn Chung! Xới đất trong vườn rồi gieo rau muống nhé 🌱',
  tree: 'Cây Kỷ Niệm — sẽ lớn theo từng kỷ niệm của hai đứa',
};

const en: Record<keyof typeof vi, string> = {
  title: 'Vườn Chung',
  coins: 'xu',
  'sp.rau_muong': 'Water spinach',
  'sp.strawberry': 'Strawberry',
  'sp.sunflower': 'Sunflower',
  tilled: 'Soil tilled',
  already_tilled: 'Already tilled',
  planted: 'Planted {species}',
  not_tilled: 'Till the soil first',
  occupied: 'Something is already growing here',
  no_seeds: 'Out of {species} seeds — visit Cô Ba’s stall',
  watered: 'Watered 💧',
  already_wet: 'Soil is still wet',
  nothing_to_water: 'Nothing to water',
  harvested: 'Harvested {n} {species} {stars}',
  not_ready: 'Not ready yet',
  nothing_here: 'Nothing here',
  shipped: 'Put {n} items in the shipping bin (≈{value} xu, paid at midnight)',
  nothing_to_ship: 'No produce in your bag',
  bought: 'Bought {n} {species} seeds',
  not_enough_coins: 'Not enough xu',
  payout: 'Last night’s shipping: +{value} xu 🎉',
  growing: '{species} is growing · {pct}%',
  wilted: '{species} is wilting — water it',
  cant_farm: 'You can only farm inside the fenced field',
  bin: 'Shipping bin',
  shop: 'Cô Ba’s stall',
  shop_hint: 'Buy seeds',
  buy: 'Buy',
  close: 'Close',
  seeds: 'Seeds',
  bag: 'Bag',
  empty_bag: 'Empty',
  action: 'Use',
  help: 'Move: WASD/arrows · Use: Space · Pick seed: 1–3',
  welcome: 'Welcome to Vườn Chung! Till the field and plant water spinach 🌱',
  tree: 'Memory Tree — it grows with every memory you two share',
};

export type MsgKey = keyof typeof vi;
const dicts: Record<Lang, Record<MsgKey, string>> = { vi, en };

let lang: Lang = 'vi';
try {
  if (localStorage.getItem('vuon-chung:lang') === 'en') lang = 'en';
} catch {
  /* storage blocked: keep default */
}

document.documentElement.lang = lang;

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem('vuon-chung:lang', l);
  } catch {
    /* ignore */
  }
}

export function t(k: string, vars: Record<string, string | number> = {}): string {
  const template = dicts[lang][k as MsgKey] ?? k;
  return template.replace(/\{(\w+)\}/g, (_match: string, v: string) => {
    const val = vars[v];
    if (v === 'species' && typeof val === 'string') return dicts[lang][`sp.${val}` as MsgKey] ?? val;
    if (v === 'stars' && typeof val === 'number') return '★'.repeat(val);
    return String(val ?? '');
  });
}
