import type { Idioma } from "../tipos";

/** Códigos ISO 3166-1 alfa-2 (más XK, Kosovo, que usan muchas pasarelas y Cloudflare). */
export const CODIGOS_PAISES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
  "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
  "UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

const CONJUNTO = new Set(CODIGOS_PAISES);

/** Normaliza un país a código ISO alfa-2. Acepta "es", "ES" y "UK" (-> GB). */
export function normalizarPais(texto: string): string | null {
  const c = String(texto ?? "").trim().toUpperCase();
  if (c === "UK") return "GB";
  return CONJUNTO.has(c) ? c : null;
}

/** Países donde el español es lengua mayoritaria u oficial: correos y página en español. */
const HISPANOHABLANTES = new Set("AR BO CL CO CR CU DO EC ES GQ GT HN MX NI PA PE PR PY SV UY VE".split(" "));

export const idiomaPorPais = (pais: string | null | undefined): Idioma => (pais && HISPANOHABLANTES.has(pais) ? "es" : "en");

const nombres = new Map<string, Intl.DisplayNames | null>();

export function nombrePais(codigo: string, idioma: Idioma = "es"): string {
  if (!nombres.has(idioma)) {
    try {
      nombres.set(idioma, new Intl.DisplayNames([idioma], { type: "region" }));
    } catch {
      nombres.set(idioma, null);
    }
  }
  try {
    return nombres.get(idioma)?.of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}

/** Países de la UE/EEE (para recordar el RGPD en el panel). */
export const UE_EEE = new Set("AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IS IT LI LT LU LV MT NL NO PL PT RO SE SI SK".split(" "));
