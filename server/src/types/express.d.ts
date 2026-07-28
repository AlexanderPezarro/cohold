import { Role } from '../../../shared/types/user.types.js';
import { ApiKeyScope } from '../../../shared/types/apiKey.types.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
      };
      apiKey?: {
        id: string;
        userId: string;
        scopes: ApiKeyScope[];
      };
    }
  }
}
