import { api } from '../api';

export interface AddressSuggestion {
  label: string;
  street: string;
  city: string;
}

export interface PostcodeLookupResult {
  postcode: string;
  city: string;
  county: string;
  addresses: AddressSuggestion[];
  /** False when the server has no address provider, so only town and county come back. */
  addressesAvailable: boolean;
}

export const addressLookupService = {
  async lookup(postcode: string): Promise<PostcodeLookupResult> {
    const response = await api.get<PostcodeLookupResult & { success: boolean }>(
      `/address-lookup/${encodeURIComponent(postcode.trim())}`
    );
    return response.data;
  },
};
