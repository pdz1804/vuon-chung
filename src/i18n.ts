// Vietnamese is the primary language; English mirrors every key.
export type Lang = 'vi' | 'en';

const vi = {
  title: 'Vườn Chung',
  coins: 'xu',
  'sp.rau_muong': 'Rau muống',
  'sp.strawberry': 'Dâu tây',
  'sp.sunflower': 'Hoa hướng dương',
  'sp.rose': 'Hoa hồng',
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
  help: 'Di chuyển: WASD/mũi tên · Làm: Space · Chọn hạt: 1–4',
  level: 'Cấp {n}',
  level_up: 'Vườn lên cấp {n}! ♥',
  update_app: 'Có bản mới của game — tải lại trang nhé',
  'unlock.orders': 'Mở bảng đơn hàng của làng',
  'unlock.rose': 'Mở hạt giống hoa hồng',
  locked: '{species} mở ở cấp cao hơn',
  locked_at: 'Cấp {n}',
  locked_orders: 'Bảng đơn hàng mở ở cấp 2',
  orders_title: 'Đơn hàng hôm nay',
  deliver: 'Giao',
  order_done: 'Đơn này xong rồi',
  order_missing: 'Cần {n} {species}',
  order_filled: 'Giao xong! +{value} xu, +{xp} XP',
  raining: 'Trời mưa, vườn tự được tưới 🌧️',
  welcome: 'Chào mừng về Vườn Chung! Xới đất trong vườn rồi gieo rau muống nhé 🌱',
  tree: 'Cây Kỷ Niệm — sẽ lớn theo từng kỷ niệm của hai đứa',
  tagline: 'Khu vườn nhỏ của hai đứa',
  sign_in: 'Đăng nhập bằng Google',
  loading: 'Đang mở vườn…',
  new_garden: 'Tạo khu vườn mới',
  pick_look: 'Chọn nhân vật của bạn',
  create: 'Tạo vườn',
  or_join: 'Hoặc dán link mời của người ấy:',
  join: 'Vào vườn',
  invite_title: 'Mời người ấy vào vườn 💌',
  invite_hint: 'Gửi link này cho người ấy. Link dùng một lần, hết hạn sau 7 ngày.',
  copy: 'Sao chép',
  copied: 'Đã chép!',
  enter: 'Vào vườn thôi',
  invite_btn: 'Mời 💌',
  invite_invalid: 'Link mời không hợp lệ hoặc đã dùng rồi',
  sync_error: 'Mất kết nối, thử lại nhé',
  retry: 'Thử lại',
};

const en: Record<keyof typeof vi, string> = {
  title: 'Vườn Chung',
  coins: 'xu',
  'sp.rau_muong': 'Water spinach',
  'sp.strawberry': 'Strawberry',
  'sp.sunflower': 'Sunflower',
  'sp.rose': 'Rose',
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
  help: 'Move: WASD/arrows · Use: Space · Pick seed: 1–4',
  level: 'Level {n}',
  level_up: 'Garden reached level {n}! ♥',
  update_app: 'A newer version is out — please reload',
  'unlock.orders': 'Village order board unlocked',
  'unlock.rose': 'Rose seeds unlocked',
  locked: '{species} unlocks at a higher level',
  locked_at: 'Level {n}',
  locked_orders: 'The order board opens at level 2',
  orders_title: 'Today’s orders',
  deliver: 'Deliver',
  order_done: 'Already delivered',
  order_missing: 'Needs {n} {species}',
  order_filled: 'Delivered! +{value} xu, +{xp} XP',
  raining: 'It’s raining — the garden waters itself 🌧️',
  welcome: 'Welcome to Vườn Chung! Till the field and plant water spinach 🌱',
  tree: 'Memory Tree — it grows with every memory you two share',
  tagline: 'A little garden for the two of you',
  sign_in: 'Sign in with Google',
  loading: 'Opening your garden…',
  new_garden: 'Start a new garden',
  pick_look: 'Pick your farmer',
  create: 'Create garden',
  or_join: 'Or paste your partner’s invite link:',
  join: 'Join',
  invite_title: 'Invite your partner 💌',
  invite_hint: 'Send this link to your partner. It works once and expires in 7 days.',
  copy: 'Copy',
  copied: 'Copied!',
  enter: 'Enter the garden',
  invite_btn: 'Invite 💌',
  invite_invalid: 'This invite link is invalid or already used',
  sync_error: 'Connection lost, try again',
  retry: 'Try again',
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
