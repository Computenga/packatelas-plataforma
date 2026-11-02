// Alcaldías de la CDMX y municipios del Estado de México donde opera Packatelas: nombres canónicos
// para que «CUAUHTEMOC», «cuauhtémoc» y «Col. Obrera, Cuauhtemoc» queden igual y se puedan filtrar.
export type Zone = "cmx" | "emx";

const LIST: { name: string; zone: Zone; aliases?: string[] }[] = [
  // CDMX
  { name: "Álvaro Obregón", zone: "cmx" },
  { name: "Azcapotzalco", zone: "cmx" },
  { name: "Benito Juárez", zone: "cmx" },
  { name: "Coyoacán", zone: "cmx" },
  { name: "Cuajimalpa", zone: "cmx", aliases: ["cuajimalpa de morelos"] },
  { name: "Cuauhtémoc", zone: "cmx" },
  { name: "Gustavo A. Madero", zone: "cmx", aliases: ["gustavo a madero", "gam"] },
  { name: "Iztacalco", zone: "cmx" },
  { name: "Iztapalapa", zone: "cmx" },
  { name: "Magdalena Contreras", zone: "cmx", aliases: ["la magdalena contreras"] },
  { name: "Miguel Hidalgo", zone: "cmx" },
  { name: "Milpa Alta", zone: "cmx" },
  { name: "Tláhuac", zone: "cmx" },
  { name: "Tlalpan", zone: "cmx" },
  { name: "Venustiano Carranza", zone: "cmx" },
  { name: "Xochimilco", zone: "cmx" },
  // Estado de México (zona metropolitana y cercanos)
  { name: "Acolman", zone: "emx" },
  { name: "Atenco", zone: "emx" },
  { name: "Atizapán de Zaragoza", zone: "emx", aliases: ["atizapan"] },
  { name: "Chalco", zone: "emx" },
  { name: "Chicoloapan", zone: "emx" },
  { name: "Chiconcuac", zone: "emx" },
  { name: "Chimalhuacán", zone: "emx" },
  { name: "Coacalco", zone: "emx", aliases: ["coacalco de berriozabal"] },
  { name: "Cuautitlán Izcalli", zone: "emx", aliases: ["izcalli"] },
  { name: "Cuautitlán", zone: "emx" },
  { name: "Ecatepec", zone: "emx", aliases: ["ecatepec de morelos"] },
  { name: "Huehuetoca", zone: "emx" },
  { name: "Huixquilucan", zone: "emx" },
  { name: "Ixtapaluca", zone: "emx" },
  { name: "Jaltenco", zone: "emx" },
  { name: "La Paz", zone: "emx", aliases: ["los reyes la paz"] },
  { name: "Lerma", zone: "emx" },
  { name: "Metepec", zone: "emx" },
  { name: "Naucalpan", zone: "emx", aliases: ["naucalpan de juarez"] },
  { name: "Nezahualcóyotl", zone: "emx", aliases: ["neza", "ciudad nezahualcoyotl", "cd nezahualcoyotl"] },
  { name: "Nicolás Romero", zone: "emx" },
  { name: "Tecámac", zone: "emx" },
  { name: "Teoloyucan", zone: "emx" },
  { name: "Tepotzotlán", zone: "emx" },
  { name: "Texcoco", zone: "emx" },
  { name: "Tlalnepantla", zone: "emx", aliases: ["tlalnepantla de baz"] },
  { name: "Toluca", zone: "emx" },
  { name: "Tultepec", zone: "emx" },
  { name: "Tultitlán", zone: "emx" },
  { name: "Valle de Chalco", zone: "emx", aliases: ["valle de chalco solidaridad"] },
  { name: "Zumpango", zone: "emx" },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Alias → municipio, de la frase más larga a la más corta («cuautitlan izcalli» antes que «cuautitlan»).
const ALIASES = LIST.flatMap((m) => [norm(m.name), ...(m.aliases ?? []).map(norm)].map((a) => ({ a, m })))
  .sort((x, y) => y.a.length - x.a.length);

export const MUNICIPIOS = LIST.map(({ name, zone }) => ({ name, zone }));
export const ZONE_LABEL: Record<Zone, string> = { cmx: "CDMX", emx: "Edomex" };

/** Valor escrito a mano («CUAUHTEMOC», «Ecatepec de Morelos») → nombre canónico, o el texto limpio si no se reconoce. */
export function canonicalMunicipio(raw?: string | null): { name: string; zone: Zone | null } | null {
  const n = norm(raw ?? "");
  if (!n) return null;
  const hit = ALIASES.find((x) => x.a === n) ?? ALIASES.find((x) => x.a.length >= 4 && (n.startsWith(`${x.a} `) || n.endsWith(` ${x.a}`)));
  if (hit) return { name: hit.m.name, zone: hit.m.zone };
  const clean = (raw ?? "").trim().replace(/\s+/g, " ");
  return { name: clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase(), zone: null };
}

/**
 * Busca la alcaldía o municipio dentro de una dirección de texto libre. Solo reconoce nombres de la
 * lista (no «La Paz» ni «GAM», que se confunden con calles o colonias).
 */
export function municipioFromAddress(address?: string | null): { name: string; zone: Zone } | null {
  const n = ` ${norm(address ?? "")} `;
  if (n.trim().length < 4) return null;
  const hit = ALIASES.find((x) => x.a.length >= 5 && x.a !== "la paz" && n.includes(` ${x.a} `));
  return hit ? { name: hit.m.name, zone: hit.m.zone } : null;
}
