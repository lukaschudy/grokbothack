// London stations and areas organisers actually say. Fallback: Nominatim.
const PLACES: [string, number, number][] = [
  ["Old Street", 51.5257, -0.0875], ["Silicon Roundabout", 51.5257, -0.0875], ["Shoreditch", 51.5245, -0.078],
  ["Shoreditch High Street", 51.5233, -0.0752], ["Hoxton", 51.5315, -0.0757], ["Liverpool Street", 51.5178, -0.0823],
  ["Moorgate", 51.5186, -0.0886], ["Barbican", 51.5204, -0.0979], ["Farringdon", 51.5203, -0.1053],
  ["Clerkenwell", 51.5235, -0.105], ["Angel", 51.5322, -0.1058], ["Islington", 51.5361, -0.1033],
  ["Highbury", 51.5461, -0.104], ["King's Cross", 51.5308, -0.1238], ["Kings Cross", 51.5308, -0.1238],
  ["St Pancras", 51.5315, -0.1266], ["Granary Square", 51.5352, -0.1255], ["Euston", 51.5282, -0.1337],
  ["Bank", 51.5133, -0.0886], ["City of London", 51.5155, -0.0922], ["The City", 51.5155, -0.0922],
  ["St Paul's", 51.5146, -0.0973], ["Aldgate", 51.5143, -0.0755], ["Aldgate East", 51.5154, -0.0726],
  ["Whitechapel", 51.5195, -0.0612], ["Bethnal Green", 51.527, -0.0549], ["Dalston", 51.5463, -0.0752],
  ["Hackney", 51.547, -0.056], ["Hackney Wick", 51.5434, -0.0249], ["Here East", 51.5467, -0.0227],
  ["Stratford", 51.5416, -0.0034], ["Canary Wharf", 51.5054, -0.0235], ["Tower Hill", 51.5098, -0.0766],
  ["London Bridge", 51.5052, -0.0864], ["Borough", 51.5011, -0.0943], ["Bermondsey", 51.4979, -0.0637],
  ["Southwark", 51.5041, -0.1052], ["Waterloo", 51.5031, -0.1132], ["South Bank", 51.5055, -0.1166],
  ["Elephant and Castle", 51.4943, -0.1001], ["Blackfriars", 51.512, -0.1031], ["Chancery Lane", 51.5185, -0.1111],
  ["Holborn", 51.5174, -0.1201], ["Covent Garden", 51.5129, -0.1243], ["Leicester Square", 51.5113, -0.1281],
  ["Tottenham Court Road", 51.5165, -0.131], ["Soho", 51.5136, -0.1365], ["Oxford Circus", 51.5152, -0.1419],
  ["Fitzrovia", 51.5205, -0.1347], ["Goodge Street", 51.5205, -0.1347], ["Warren Street", 51.5247, -0.1384],
  ["Bloomsbury", 51.523, -0.1244], ["Russell Square", 51.523, -0.1244], ["Marylebone", 51.5225, -0.1631],
  ["Baker Street", 51.5226, -0.1571], ["Paddington", 51.5154, -0.1755], ["Mayfair", 51.5099, -0.1478],
  ["Green Park", 51.5067, -0.1428], ["Piccadilly Circus", 51.5098, -0.1342], ["Westminster", 51.501, -0.1254],
  ["Victoria", 51.4965, -0.1447], ["Vauxhall", 51.4861, -0.1253], ["Battersea", 51.4799, -0.1416],
  ["Brixton", 51.4627, -0.1145], ["Clapham", 51.4643, -0.1704], ["Camden", 51.5392, -0.1426],
  ["Camden Town", 51.5392, -0.1426], ["Kentish Town", 51.5507, -0.1402], ["Hammersmith", 51.4927, -0.224],
  ["White City", 51.512, -0.224], ["Shepherd's Bush", 51.5046, -0.2187], ["Notting Hill", 51.5094, -0.1967],
  ["South Kensington", 51.4941, -0.1738], ["Knightsbridge", 51.5015, -0.1607], ["Central London", 51.5145, -0.1065]
];

export type Place = { name: string; lat: number; lng: number };

const norm = (s: string) => s.toLowerCase().replace(/['’.]/g, "").replace(/\b(station|tube|area|london)\b/g, "").replace(/\s+/g, " ").trim();

export function lookupPlace(query: string): Place | null {
  const q = norm(query);
  if (!q) return null;
  const exact = PLACES.find(([n]) => norm(n) === q);
  const hit = exact ?? PLACES.find(([n]) => q.includes(norm(n))) ?? PLACES.find(([n]) => norm(n).includes(q));
  return hit ? { name: hit[0], lat: hit[1], lng: hit[2] } : null;
}

export async function geocode(query: string): Promise<Place | null> {
  const local = lookupPlace(query);
  if (local) return local;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&viewbox=-0.51,51.69,0.33,51.28&bounded=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "User-Agent": "Roomline/0.1 (London venue finder)" }, signal: AbortSignal.timeout(2500) });
    const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    return hit ? { name: query, lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch {
    return null;
  }
}
