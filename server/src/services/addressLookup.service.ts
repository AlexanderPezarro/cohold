/**
 * UK postcode lookup for the add-property forms.
 *
 * Two sources, because street addresses aren't free in the UK (they come from
 * Royal Mail's PAF):
 *  - postcodes.io (free, no key) always checks the postcode and gives town and
 *    county, so the form is useful with no configuration at all.
 *  - an optional address provider lists the individual addresses at the
 *    postcode: Ideal Postcodes when IDEAL_POSTCODES_API_KEY is set, otherwise
 *    OS Places when OS_PLACES_API_KEY is set. Another provider is one more
 *    `AddressProvider`.
 */

const POSTCODES_IO_URL = 'https://api.postcodes.io/postcodes';
const OS_PLACES_URL = 'https://api.os.uk/search/places/v1/postcode';
const IDEAL_POSTCODES_URL = 'https://api.ideal-postcodes.co.uk/v1/postcodes';
const REQUEST_TIMEOUT_MS = 5000;

/** Loose UK postcode shape; the lookup itself is the real check. */
const POSTCODE_PATTERN = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s?[0-9][A-Z]{2}$/i;

export interface AddressSuggestion {
  /** One-line address for the picker. */
  label: string;
  street: string;
  city: string;
  /** Postal county, when the provider knows it. */
  county?: string;
}

export interface PostcodeLookupResult {
  postcode: string;
  city: string;
  county: string;
  addresses: AddressSuggestion[];
  /** False when no address provider is configured, so the UI can skip the picker. */
  addressesAvailable: boolean;
}

interface AddressProvider {
  findAddresses(postcode: string): Promise<AddressSuggestion[]>;
}

export class InvalidPostcodeError extends Error {
  constructor() {
    super('Enter a valid UK postcode');
    this.name = 'InvalidPostcodeError';
  }
}

export class PostcodeNotFoundError extends Error {
  constructor() {
    super('We couldn’t find that postcode');
    this.name = 'PostcodeNotFoundError';
  }
}

export function normalisePostcode(input: string): string {
  const compact = input.replace(/\s+/g, '').toUpperCase();
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/** "Bristol, City of" -> "Bristol"; "Kingston upon Hull, City of" -> "Kingston upon Hull". */
function tidyDistrict(name: string): string {
  return name.replace(/,\s*City of$/i, '').trim();
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

interface PostcodesIoResult {
  postcode: string;
  admin_district: string | null;
  admin_county: string | null;
  region: string | null;
}

interface OsPlacesDpa {
  ADDRESS: string;
  ORGANISATION_NAME?: string;
  SUB_BUILDING_NAME?: string;
  BUILDING_NAME?: string;
  BUILDING_NUMBER?: string;
  DEPENDENT_THOROUGHFARE_NAME?: string;
  THOROUGHFARE_NAME?: string;
  DEPENDENT_LOCALITY?: string;
  POST_TOWN: string;
  POSTCODE: string;
}

export class OsPlacesProvider implements AddressProvider {
  constructor(private readonly apiKey: string) {}

  async findAddresses(postcode: string): Promise<AddressSuggestion[]> {
    const url = `${OS_PLACES_URL}?postcode=${encodeURIComponent(postcode)}&dataset=DPA&key=${encodeURIComponent(this.apiKey)}`;
    const { status, body } = await fetchJson(url);
    if (status !== 200) {
      throw new Error(`OS Places responded with ${status}`);
    }
    const results = (body as { results?: Array<{ DPA?: OsPlacesDpa }> } | null)?.results ?? [];

    return results
      .map((result) => result.DPA)
      .filter((dpa): dpa is OsPlacesDpa => Boolean(dpa))
      .map((dpa) => {
        const road = [dpa.DEPENDENT_THOROUGHFARE_NAME, dpa.THOROUGHFARE_NAME]
          .filter(Boolean)
          .join(', ');
        const numberedRoad = [dpa.BUILDING_NUMBER, road].filter(Boolean).join(' ');
        const street = [
          dpa.ORGANISATION_NAME,
          dpa.SUB_BUILDING_NAME,
          dpa.BUILDING_NAME,
          numberedRoad,
          dpa.DEPENDENT_LOCALITY,
        ]
          .filter(Boolean)
          .map((part) => titleCase(part as string))
          .join(', ');
        const city = titleCase(dpa.POST_TOWN);
        return { label: `${street}, ${city}`, street, city };
      });
  }
}

interface IdealPostcodesAddress {
  line_1: string;
  line_2: string;
  line_3: string;
  post_town: string;
  county: string;
}

export class IdealPostcodesProvider implements AddressProvider {
  constructor(private readonly apiKey: string) {}

  async findAddresses(postcode: string): Promise<AddressSuggestion[]> {
    const url = `${IDEAL_POSTCODES_URL}/${encodeURIComponent(postcode)}?api_key=${encodeURIComponent(this.apiKey)}`;
    const { status, body } = await fetchJson(url);
    // 4040: postcodes.io knew it but PAF doesn't (e.g. a brand-new or
    // non-delivery postcode); that's just "no addresses", not a failure.
    if (status === 404) return [];
    if (status !== 200) {
      // e.g. 4010 invalid key, 4020 balance depleted, 4021 limit reached.
      const code = (body as { code?: number; message?: string } | null) ?? {};
      throw new Error(`Ideal Postcodes responded with ${status} (${code.code}: ${code.message})`);
    }
    const results = (body as { result?: IdealPostcodesAddress[] } | null)?.result ?? [];

    return results.map((address) => {
      // Lines are already cased properly; only the post town comes in capitals.
      const street = [address.line_1, address.line_2, address.line_3].filter(Boolean).join(', ');
      const city = titleCase(address.post_town);
      return {
        label: `${street}, ${city}`,
        street,
        city,
        ...(address.county ? { county: address.county } : {}),
      };
    });
  }
}

function configuredProvider(): AddressProvider | null {
  const idealKey = process.env.IDEAL_POSTCODES_API_KEY;
  if (idealKey) return new IdealPostcodesProvider(idealKey);
  const osKey = process.env.OS_PLACES_API_KEY;
  return osKey ? new OsPlacesProvider(osKey) : null;
}

export async function lookupPostcode(
  input: string,
  provider: AddressProvider | null = configuredProvider()
): Promise<PostcodeLookupResult> {
  const postcode = normalisePostcode(input);
  if (!POSTCODE_PATTERN.test(postcode)) {
    throw new InvalidPostcodeError();
  }

  const { status, body } = await fetchJson(`${POSTCODES_IO_URL}/${encodeURIComponent(postcode)}`);
  if (status === 404) {
    throw new PostcodeNotFoundError();
  }
  if (status !== 200) {
    throw new Error(`postcodes.io responded with ${status}`);
  }
  const place = (body as { result: PostcodesIoResult }).result;

  const district = place.admin_district ? tidyDistrict(place.admin_district) : '';
  const county = place.admin_county ?? (place.region === 'London' ? 'Greater London' : district);

  let addresses: AddressSuggestion[] = [];
  if (provider) {
    try {
      addresses = await provider.findAddresses(place.postcode);
    } catch (error) {
      // Town and county are still worth returning; the user types the street.
      console.error('Address provider lookup failed:', error);
    }
  }

  return {
    postcode: place.postcode,
    // The provider's post town beats the council district ("Westminster" vs "London").
    city: addresses[0]?.city ?? district,
    // The postal county is what people write on an address; the council area is a fallback.
    county: addresses[0]?.county ?? county,
    addresses,
    addressesAvailable: provider !== null,
  };
}
