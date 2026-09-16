import { LoginInput } from './auth.types';

export class AuthService {
  async login(_credentials: LoginInput): Promise<never> {
    throw new Error('Legacy authentication is disabled');
  }
}
