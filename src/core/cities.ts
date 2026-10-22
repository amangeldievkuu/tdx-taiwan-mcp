/** TDX `City` path codes and their Chinese names, cities (市) before counties (縣) of the same name. */
export const CITIES = {
  Taipei: '臺北市',
  NewTaipei: '新北市',
  Taoyuan: '桃園市',
  Taichung: '臺中市',
  Tainan: '臺南市',
  Kaohsiung: '高雄市',
  Keelung: '基隆市',
  Hsinchu: '新竹市',
  HsinchuCounty: '新竹縣',
  MiaoliCounty: '苗栗縣',
  ChanghuaCounty: '彰化縣',
  NantouCounty: '南投縣',
  YunlinCounty: '雲林縣',
  Chiayi: '嘉義市',
  ChiayiCounty: '嘉義縣',
  PingtungCounty: '屏東縣',
  YilanCounty: '宜蘭縣',
  HualienCounty: '花蓮縣',
  TaitungCounty: '臺東縣',
  KinmenCounty: '金門縣',
  PenghuCounty: '澎湖縣',
  LienchiangCounty: '連江縣',
} as const;

export type CityCode = keyof typeof CITIES;

const fold = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Maps what a model or user may write (`taipei`, `New Taipei City`, `臺北市`, `台北`, `新竹`) to
 * the TDX code (`Taipei`, `NewTaipei`, `Hsinchu`). Unknown values pass through unchanged, so TDX
 * can answer with its list of accepted cities.
 */
export function normalizeCity(input: string): string {
  const value = input.trim();
  const latin = fold(value).replace(/city$/, '');
  const zh = value.replaceAll('台', '臺');
  for (const code of Object.keys(CITIES)) {
    if (fold(code) === latin) return code;
  }
  for (const [code, chinese] of Object.entries(CITIES)) {
    if (chinese === zh || chinese.slice(0, -1) === zh) return code;
  }
  return value;
}
