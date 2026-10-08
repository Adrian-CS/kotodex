// Los 214 radicales Kangxi: número y nombre.
//
// Generado con Python a partir de Unicode (15.1.0): cada carácter del bloque «Kangxi
// Radicals» (U+2F00–U+2FD5) se normaliza (NFKC) a su ideograma normal (⼼ → 心) y su nombre oficial
// («KANGXI RADICAL HEART») da el significado. Las variantes como 忄 llegan aquí por su original (心),
// que KanjiVG indica en kvg:original.

/** El radical n.º i+1 es el carácter i de esta cadena. */
const RADICALES = "一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見角言谷豆豕豸貝赤走足身車辛辰辵邑酉釆里金長門阜隶隹雨靑非面革韋韭音頁風飛食首香馬骨高髟鬥鬯鬲鬼魚鳥鹵鹿麥麻黃黍黑黹黽鼎鼓鼠鼻齊齒龍龜龠";

const NOMBRES = "one|line|dot|slash|second|hook|two|lid|man|legs|enter|eight|down box|cover|ice|table|open box|knife|power|wrap|spoon|right open box|hiding enclosure|ten|divination|seal|cliff|private|again|mouth|enclosure|earth|scholar|go|go slowly|evening|big|woman|child|roof|inch|small|lame|corpse|sprout|mountain|river|work|oneself|turban|dry|short thread|dotted cliff|long stride|two hands|shoot|bow|snout|bristle|step|heart|halberd|door|hand|branch|rap|script|dipper|axe|square|not|sun|say|moon|tree|lack|stop|death|weapon|do not|compare|fur|clan|steam|water|fire|claw|father|double x|half tree trunk|slice|fang|cow|dog|profound|jade|melon|tile|sweet|life|use|field|bolt of cloth|sickness|dotted tent|white|skin|dish|eye|spear|arrow|stone|spirit|track|grain|cave|stand|bamboo|rice|silk|jar|net|sheep|feather|old|and|plow|ear|brush|meat|minister|self|arrive|mortar|tongue|oppose|boat|stopping|color|grass|tiger|insect|blood|walk enclosure|clothes|west|see|horn|speech|valley|bean|pig|badger|shell|red|run|foot|body|cart|bitter|morning|walk|city|wine|distinguish|village|gold|long|gate|mound|slave|short tailed bird|rain|blue|wrong|face|leather|tanned leather|leek|sound|leaf|wind|fly|eat|head|fragrant|horse|bone|tall|hair|fight|sacrificial wine|cauldron|ghost|fish|bird|salt|deer|wheat|hemp|yellow|millet|black|embroidery|frog|tripod|drum|rat|nose|even|tooth|dragon|turtle|flute".split("|");

export interface Radical { numero: number; nombre: string; caracter: string }

/** El radical Kangxi que corresponde a un carácter (心, 水, 食…), o undefined si no es uno. */
export function radicalKangxi(caracter: string): Radical | undefined {
  const i = [...RADICALES].indexOf(caracter);
  return i < 0 ? undefined : { numero: i + 1, nombre: NOMBRES[i], caracter };
}
