import { resolve } from '../core/names.js';

export interface TaiwanAirport {
  /** IATA code. */
  id: string;
  zh: string;
  en: string;
  /** Other names people use: the city, the district, the island. */
  aliases: string[];
}

/**
 * Taiwan's 17 airports, the ones with FIDS boards and METAR. Kept here rather than read from
 * `/v2/Air/Airport`, whose 469 airports carry no city or district names to match on. "Taipei"
 * and "Matsu" name two airports each, so they come back ambiguous.
 */
export const TAIWAN_AIRPORTS: readonly TaiwanAirport[] = [
  {
    id: 'TPE',
    zh: '桃園國際機場',
    en: 'Taoyuan International Airport',
    aliases: ['桃園', '桃機', '臺北', 'Taoyuan', 'Taipei'],
  },
  {
    id: 'TSA',
    zh: '臺北松山機場',
    en: 'Taipei Songshan Airport',
    aliases: ['松山', '臺北', 'Songshan', 'Taipei'],
  },
  {
    id: 'KHH',
    zh: '高雄國際機場',
    en: 'Kaohsiung International Airport',
    aliases: ['高雄', '小港', 'Kaohsiung'],
  },
  {
    id: 'RMQ',
    zh: '臺中國際機場',
    en: 'Taichung International Airport',
    aliases: ['臺中', '清泉崗', 'Taichung'],
  },
  { id: 'TNN', zh: '臺南機場', en: 'Tainan Airport', aliases: ['臺南', 'Tainan'] },
  { id: 'CYI', zh: '嘉義機場', en: 'Chiayi Airport', aliases: ['嘉義', 'Chiayi'] },
  { id: 'HUN', zh: '花蓮機場', en: 'Hualien Airport', aliases: ['花蓮', 'Hualien'] },
  { id: 'TTT', zh: '臺東機場', en: 'Taitung Airport', aliases: ['臺東', '豐年', 'Taitung'] },
  {
    id: 'MZG',
    zh: '澎湖機場',
    en: 'Penghu Airport',
    aliases: ['澎湖', '馬公', 'Penghu', 'Magong'],
  },
  { id: 'KNH', zh: '金門機場', en: 'Kinmen Airport', aliases: ['金門', '尚義', 'Kinmen'] },
  {
    id: 'MFK',
    zh: '馬祖北竿機場',
    en: 'Matsu Beigan Airport',
    aliases: ['北竿', '馬祖', 'Beigan', 'Matsu'],
  },
  {
    id: 'LZN',
    zh: '馬祖南竿機場',
    en: 'Matsu Nangan Airport',
    aliases: ['南竿', '馬祖', 'Nangan', 'Matsu'],
  },
  {
    id: 'KYD',
    zh: '蘭嶼機場',
    en: 'Lanyu Airport',
    aliases: ['蘭嶼', 'Lanyu', 'Orchid Island'],
  },
  { id: 'GNI', zh: '綠島機場', en: 'Green Island Airport', aliases: ['綠島', 'Green Island'] },
  { id: 'WOT', zh: '望安機場', en: 'Wang-an Airport', aliases: ['望安', 'Wangan'] },
  { id: 'CMJ', zh: '七美機場', en: 'Qimei Airport', aliases: ['七美', 'Qimei'] },
  { id: 'HCN', zh: '恆春機場', en: 'Hengchun Airport', aliases: ['恆春', 'Hengchun'] },
];

/** The Taiwan airport `input` names: an IATA code or a name. Throws a `ToolInputError` otherwise. */
export function findAirport(input: string): TaiwanAirport {
  const [airport] = resolve(TAIWAN_AIRPORTS, input, {
    names: (a) => [a.zh, a.en, ...a.aliases],
    ids: (a) => [a.id],
    label: 'Taiwan airport',
  });
  return airport;
}
