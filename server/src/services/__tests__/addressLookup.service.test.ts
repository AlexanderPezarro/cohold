import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  IdealPostcodesProvider,
  InvalidPostcodeError,
  OsPlacesProvider,
  PostcodeNotFoundError,
  lookupPostcode,
  normalisePostcode,
} from '../addressLookup.service.js';

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

const postcodesIo = (overrides: Record<string, unknown> = {}) =>
  jsonResponse(200, {
    result: {
      postcode: 'GU1 1AA',
      admin_district: 'Guildford',
      admin_county: 'Surrey',
      region: 'South East',
      ...overrides,
    },
  });

describe('addressLookup.service', () => {
  const fetchMock = jest.fn<typeof fetch>();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('normalises spacing and case', () => {
    expect(normalisePostcode(' gu11aa ')).toBe('GU1 1AA');
    expect(normalisePostcode('sw1a  1aa')).toBe('SW1A 1AA');
  });

  it('rejects something that is not shaped like a postcode without calling out', async () => {
    await expect(lookupPostcode('hello', null)).rejects.toBeInstanceOf(InvalidPostcodeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unknown postcode', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Postcode not found' }));
    await expect(lookupPostcode('ZZ9 9ZZ', null)).rejects.toBeInstanceOf(PostcodeNotFoundError);
  });

  it('fills town and county with no address provider', async () => {
    fetchMock.mockResolvedValue(postcodesIo());
    const result = await lookupPostcode('gu11aa', null);
    expect(result).toEqual({
      postcode: 'GU1 1AA',
      city: 'Guildford',
      county: 'Surrey',
      addresses: [],
      addressesAvailable: false,
    });
  });

  it('tidies unitary authorities and London', async () => {
    fetchMock.mockResolvedValueOnce(
      postcodesIo({ admin_district: 'Bristol, City of', admin_county: null, region: 'South West' })
    );
    expect(await lookupPostcode('BS1 4DJ', null)).toMatchObject({
      city: 'Bristol',
      county: 'Bristol',
    });

    fetchMock.mockResolvedValueOnce(
      postcodesIo({ admin_district: 'Westminster', admin_county: null, region: 'London' })
    );
    expect(await lookupPostcode('SW1A 1AA', null)).toMatchObject({ county: 'Greater London' });
  });

  it('lists OS Places addresses and prefers their post town', async () => {
    fetchMock.mockResolvedValueOnce(postcodesIo()).mockResolvedValueOnce(
      jsonResponse(200, {
        results: [
          {
            DPA: {
              ADDRESS: '1, HIGH STREET, GUILDFORD, GU1 1AA',
              BUILDING_NUMBER: '1',
              THOROUGHFARE_NAME: 'HIGH STREET',
              POST_TOWN: 'GUILDFORD',
              POSTCODE: 'GU1 1AA',
            },
          },
          {
            DPA: {
              ADDRESS: 'FLAT 2, ROSE HOUSE, HIGH STREET, GUILDFORD, GU1 1AA',
              SUB_BUILDING_NAME: 'FLAT 2',
              BUILDING_NAME: 'ROSE HOUSE',
              THOROUGHFARE_NAME: 'HIGH STREET',
              POST_TOWN: 'GUILDFORD',
              POSTCODE: 'GU1 1AA',
            },
          },
        ],
      })
    );

    const result = await lookupPostcode('GU1 1AA', new OsPlacesProvider('key-123'));

    expect(String(fetchMock.mock.calls[1][0])).toContain('key=key-123');
    expect(result.addressesAvailable).toBe(true);
    expect(result.addresses).toEqual([
      { label: '1 High Street, Guildford', street: '1 High Street', city: 'Guildford' },
      {
        label: 'Flat 2, Rose House, High Street, Guildford',
        street: 'Flat 2, Rose House, High Street',
        city: 'Guildford',
      },
    ]);
  });

  it('still returns town and county when the address provider fails', async () => {
    fetchMock
      .mockResolvedValueOnce(postcodesIo())
      .mockResolvedValueOnce(jsonResponse(401, { error: 'bad key' }));

    const result = await lookupPostcode('GU1 1AA', new OsPlacesProvider('bad'));
    expect(result).toMatchObject({ city: 'Guildford', addresses: [], addressesAvailable: true });
  });
  it('lists Ideal Postcodes addresses and prefers their post town and postal county', async () => {
    fetchMock
      .mockResolvedValueOnce(
        postcodesIo({
          postcode: 'SW1A 2AA',
          admin_district: 'Westminster',
          admin_county: null,
          region: 'London',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          code: 2000,
          message: 'Success',
          result: [
            {
              line_1: 'Prime Minister & First Lord of the Treasury',
              line_2: '10 Downing Street',
              line_3: '',
              post_town: 'LONDON',
              county: '',
            },
            {
              line_1: 'Flat 2',
              line_2: '1 High Street',
              line_3: '',
              post_town: 'GUILDFORD',
              county: 'Surrey',
            },
          ],
        })
      );

    const result = await lookupPostcode('SW1A 2AA', new IdealPostcodesProvider('ak_123'));

    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://api.ideal-postcodes.co.uk/v1/postcodes/SW1A%202AA?api_key=ak_123'
    );
    expect(result.city).toBe('London');
    // The first address has no postal county, so the council fallback stays.
    expect(result.county).toBe('Greater London');
    expect(result.addresses).toEqual([
      {
        label: 'Prime Minister & First Lord of the Treasury, 10 Downing Street, London',
        street: 'Prime Minister & First Lord of the Treasury, 10 Downing Street',
        city: 'London',
      },
      {
        label: 'Flat 2, 1 High Street, Guildford',
        street: 'Flat 2, 1 High Street',
        city: 'Guildford',
        county: 'Surrey',
      },
    ]);
  });

  it('treats an Ideal Postcodes 404 as no addresses, and a depleted key as a provider failure', async () => {
    fetchMock
      .mockResolvedValueOnce(postcodesIo())
      .mockResolvedValueOnce(jsonResponse(404, { code: 4040, message: 'Postcode not found' }));
    expect(await lookupPostcode('GU1 1AA', new IdealPostcodesProvider('k'))).toMatchObject({
      city: 'Guildford',
      addresses: [],
    });

    fetchMock
      .mockResolvedValueOnce(postcodesIo())
      .mockResolvedValueOnce(jsonResponse(402, { code: 4020, message: 'Key balance depleted' }));
    expect(await lookupPostcode('GU1 1AA', new IdealPostcodesProvider('k'))).toMatchObject({
      city: 'Guildford',
      county: 'Surrey',
      addresses: [],
      addressesAvailable: true,
    });
    expect(console.error).toHaveBeenCalled();
  });
});
