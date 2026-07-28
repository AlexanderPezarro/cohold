import { api } from '../api';
import type { ApiKeyListItem, CreateApiKeyRequest, CreateApiKeyResponse } from '../../../../shared/types/apiKey.types';

interface ApiKeysListResponse {
  success: boolean;
  keys: ApiKeyListItem[];
}

interface ApiKeyCreateResponse {
  success: boolean;
  key: CreateApiKeyResponse;
}

export const apiKeysService = {
  async listKeys(): Promise<ApiKeyListItem[]> {
    const response = await api.get<ApiKeysListResponse>('/api-keys');
    return response.data.keys;
  },

  async createKey(data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const response = await api.post<ApiKeyCreateResponse>('/api-keys', data);
    return response.data.key;
  },

  async revokeKey(id: string): Promise<void> {
    await api.delete(`/api-keys/${id}`);
  },
};
