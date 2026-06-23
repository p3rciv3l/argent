export interface ParsedDescriptorLocation {
  city: string;
  region: string;
  country: "US";
}

const US_STATE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY"
] as const;

const STATE_PATTERN = US_STATE_CODES.join("|");
const US_STATE_CODE_SET = new Set<string>(US_STATE_CODES);

function normalizeDescriptor(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function stripTrailingNoise(value: string): string {
  let text = normalizeDescriptor(value);
  text = text.replace(/\s+\d{3}[- ]\d{3}[- ]\d{4}(?:\s+[A-Z]{2})?$/i, "");
  text = text.replace(
    /\s+(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.(?:com|net|org|co|io)(?:\s+[A-Z]{2})?$/i,
    ""
  );
  text = text.replace(/\s+X{3,}[A-Z0-9X]*$/i, "");
  text = text.replace(/\s+(?:\d{3,5}\s+){1,4}-?\d+\.\d{2}$/i, "");
  text = text.replace(/\s+(?:\d{3,5}\s*){1,4}$/i, "");
  return normalizeDescriptor(text);
}

function isPlausibleCityToken(value: string): boolean {
  return /^[A-Z][A-Z'.-]*$/i.test(value) && !/\d|#|\*|@|\.com|\.net|\.org/i.test(value);
}

function matchGenericCityState(text: string): ParsedDescriptorLocation | null {
  const stateMatch = text.match(new RegExp(`\\s(?<region>${STATE_PATTERN})$`, "i"));
  const region = stateMatch?.groups?.region?.toUpperCase();
  if (!region) {
    return null;
  }

  const beforeRegion = text.slice(0, -region.length).trim();
  if (!beforeRegion || /(?:\d|#|\*|@|\.com|\.net|\.org|\.co|\.io)$/i.test(beforeRegion)) {
    return null;
  }

  const tokens = beforeRegion.split(/\s+/).filter(Boolean);
  for (const size of [3, 2, 1]) {
    const cityTokens = tokens.slice(-size);
    if (cityTokens.length !== size || !cityTokens.every(isPlausibleCityToken)) {
      continue;
    }

    const startsLikeMultiWordCity = /^(ST|SAINT|SAN|SANTA|LOS|LAS|NEW|FORT|PORT|EL|LA)$/i.test(
      cityTokens[0] ?? ""
    );
    if (size > 1 && !startsLikeMultiWordCity) {
      continue;
    }

    return {
      city: titleCase(cityTokens.join(" ")),
      region,
      country: "US"
    };
  }

  return null;
}

export function parseDescriptorLocation(rawDescription: string | null | undefined): ParsedDescriptorLocation | null {
  if (!rawDescription) {
    return null;
  }

  const text = stripTrailingNoise(rawDescription);
  if (!text) {
    return null;
  }

  return matchGenericCityState(text);
}

export function normalizeUsStateCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return US_STATE_CODE_SET.has(normalized) ? normalized : null;
}
